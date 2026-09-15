"""One whole-document request builds the navigation, without sheet-review passes."""
import base64
import copy
import hashlib
import json
from pathlib import Path
import httpx
from pydantic import Field
from backend.ingestion import Record, Structure, PipelineError, Paused, GUARD, atomic, strict_schema, validate_structure

VERSION = 'navigation-v1'
PROMPT = '''Build a useful, clickable project drawing directory from the ENTIRE attached PDF.
The user's goal is navigation first: start from the zoomed-out overall or demarcation plan,
discover EVERY project area/section, and make each area a button that opens its related
drawings in a useful work sequence: overview/existing, demolition, proposed work,
plans, front/side elevations, sections, finishes and details, ONLY where present.
Those are examples, not mandatory categories. Infer this project's own terminology.
A renovation might use area codes such as TA 05; other PDFs may use wings, rooms,
buildings or descriptive names. Discover names from THIS PDF; never assume example codes exist.
Read across the entire set before deciding its structure. Use the drawing register,
demarcation legends, titles and cross-references together. Shared typical details may
belong to several areas when the PDF establishes applicability. Group electrical and
other building services by their actual discipline; do not invent room relationships
for system-wide schematics. Keep unassigned sheets available in All drawings.
This is a navigation task, NOT an engineering review, quantity takeoff, or per-page audit.
Return one compact navigation record for EVERY physical PDF page, including covers,
registers and blank sheets. Use supplied physical page numbers, not printed drawing numbers.
Provide concise accurate sheet titles, drawing numbers, stages, disciplines, levels,
view names (e.g. Front elevation) and related area keys. Do not transcribe entire sheets.
Use only source-supported areas and page assignments. Leave uncertain links empty and
record concise project-level warnings. Native text is supplied to help page numbering;
it may be absent or garbled. Do not treat register entries as proof a sheet is present.
No confidence scores or approval queue are needed. Output the complete navigation JSON.
'''

class NavSheet(Record):
    page: int = Field(ge=1, le=500)
    title: str = Field(min_length=1, max_length=500)
    number: str = Field(max_length=150)
    stage: str = Field(min_length=1, max_length=100)
    discipline: str = Field(min_length=1, max_length=100)
    levels: list[str] = Field(max_length=30)
    views: list[str] = Field(max_length=30)
    areas: list[str] = Field(max_length=150)
    references: list[str] = Field(max_length=100)
    is_service: bool

class Navigation(Record):
    structure: Structure
    sheets: list[NavSheet] = Field(min_length=1, max_length=500)

def usage_metrics(usage):
    prompt=usage.get('prompt_tokens_details') or {}
    costs=usage.get('cost_details') or {}
    total_cost=usage.get('cost')
    inference_cost=costs.get('upstream_inference_cost')
    parser_cost=max(0,total_cost-inference_cost) if total_cost is not None and inference_cost is not None else None
    return dict(
        requests=1,input_tokens=usage.get('prompt_tokens',0),output_tokens=usage.get('completion_tokens',0),
        tokens=usage.get('total_tokens',0),cached_tokens=prompt.get('cached_tokens',0),
        cache_write_tokens=prompt.get('cache_write_tokens',0),
        input_cost_usd=costs.get('upstream_inference_prompt_cost'),
        output_cost_usd=costs.get('upstream_inference_completions_cost'),
        inference_cost_usd=inference_cost,pdf_parser_cost_usd=parser_cost,
        reported_cost_usd=total_cost)

def validate_navigation(result, n):
    validate_structure(result.structure, set(range(1,n+1)))
    if sorted(s.page for s in result.sheets) != list(range(1,n+1)):
        raise PipelineError('The AI omitted or duplicated source pages. Navigation was not published. Retry generation.')
    known = {a.key for a in result.structure.areas}
    for s in result.sheets:
        if len(set(s.areas)) != len(s.areas) or not set(s.areas) <= known:
            raise PipelineError('The AI returned an invalid area link. Navigation was not published.')

class NavigationProvider:
    def __init__(self, key, model): self.key, self.model = key, model
    def __call__(self, data, pdf):
        content = [dict(type='text', text=json.dumps(data,ensure_ascii=False)),
                   dict(type='file', file=dict(filename='drawing-set.pdf', file_data='data:application/pdf;base64,'+base64.b64encode(pdf).decode()))]
        payload = dict(model=self.model, provider={'require_parameters':True},
            messages=[dict(role='system',content=GUARD+PROMPT),dict(role='user',content=content)],
            plugins=[{'id':'file-parser','pdf':{'engine':'mistral-ocr'}}],
            response_format={'type':'json_schema','json_schema':{'name':'Navigation','strict':True,'schema':strict_schema(Navigation)}},
            max_tokens=48000)
        try:
            r=httpx.post('https://openrouter.ai/api/v1/chat/completions',headers={'Authorization':'Bearer '+self.key},json=payload,timeout=httpx.Timeout(600,connect=30))
            r.raise_for_status(); body=r.json()
            if body.get('error'): raise PipelineError('OpenRouter could not analyze the whole PDF. Check model availability and credits, then retry.')
            choice=body['choices'][0]
            if choice.get('finish_reason')=='length': raise PipelineError('The navigation exceeded the model output limit. No incomplete directory was published.')
            return Navigation.model_validate_json(choice['message']['content']),body.get('usage',{})
        except httpx.HTTPStatusError as exc:
            raise PipelineError(f'OpenRouter HTTP {exc.response.status_code} while reading the whole PDF. Check credits, PDF size and model support. No automatic retry was made.') from exc
        except (httpx.HTTPError,ValueError,KeyError,IndexError) as exc:
            raise PipelineError('Whole-document analysis timed out or returned invalid navigation. Your PDF is saved; retry generation.') from exc

class NavigationPipeline:
    def __init__(self,directory,project,provider,model,update,cancelled=lambda:False,max_requests=1000):
        self.directory=Path(directory); self.project=copy.deepcopy(project)
        self.provider=provider; self.model=model; self.update=update; self.cancelled=cancelled
    def run(self):
        if self.cancelled(): raise Paused()
        p=self.project
        self.update(dict(status='running',phase='document',done=0,total=1,current_page=None,requests=0,tokens=0,reported_cost_usd=None,model=self.model))
        pdf=(self.directory/'source.pdf').read_bytes()
        fingerprint=hashlib.sha256(VERSION.encode()+self.model.encode()+pdf).hexdigest()
        cache=self.directory/'ai-cache'/'navigation'; cache.mkdir(parents=True,exist_ok=True)
        target=cache/(fingerprint+'.json')
        data=dict(page_count=p['page_count'],physical_pages=[dict(page=s['page'],text=s['text']) for s in p['pages']])
        if sum(len(s['text']) for s in p['pages'])>1800000:
            raise PipelineError('The document text exceeds the whole-document context budget. Use a smaller drawing volume.')
        if target.exists():
            saved=json.loads(target.read_text(encoding='utf8')); result=Navigation.model_validate(saved['result']); usage=saved['usage']
        else:
            result,usage=self.provider(data,pdf)
            self.update(dict(status='running',phase='document',done=0,total=1,**usage_metrics(usage)))
            validate_navigation(result,p['page_count'])
            atomic(target,dict(result=result.model_dump(),usage=usage))
        validate_navigation(result,p['page_count'])
        if self.cancelled(): raise Paused()
        self.update(dict(status='running',phase='publishing',done=0,total=1,**usage_metrics(usage)))
        st=result.structure; by_page={s.page:s for s in result.sheets}
        for s in p['pages']:
            nav=by_page[s['page']]; s.update(nav.model_dump(exclude={'areas','page'}))
            s.update(areas=[dict(area=a,basis='Related in whole-document navigation',relationship='direct',evidence=[],review=False) for a in nav.areas],notes=[],needs_review=False,reviewed=False,source='AI · whole-document navigation',is_overview=s['page'] in st.overview_pages,is_register=nav.discipline.lower()=='register')
        p.update(name=st.project_name,description=st.description,areas=[dict(id=a.key,label=a.label,wing=a.group,kind=a.kind,aliases=a.aliases,levels=a.levels,source_page=a.evidence[0].page,evidence=[e.model_dump() for e in a.evidence]) for a in st.areas],overview_pages=st.overview_pages,overview_page=st.overview_pages[0] if st.overview_pages else None,hotspots=[],stages=list(dict.fromkeys(st.stage_order+[s['stage'] for s in p['pages']])),warnings=st.warnings,engine='ai-v2',profile=VERSION,generation_complete=True,model=self.model,navigation_only=True,ai_metrics=usage_metrics(usage))
        return p
