import copy
import pytest
from backend.navigation import Navigation, NavigationPipeline, NavigationProvider, usage_metrics, validate_navigation
from backend.ingestion import PipelineError
from tests.test_app import source_project, ControlledProvider, Structure

def output():
    structure,_=ControlledProvider()(Structure,'',{})
    return Navigation.model_validate(dict(structure=structure.model_dump(),sheets=[dict(page=i,title='Overview' if i==1 else 'Front elevation',number=str(i),stage='Overview' if i==1 else 'Proposed',discipline='Interior',levels=[],views=['Plan' if i==1 else 'Front elevation'],areas=['LAB-X7'],references=[],is_service=False) for i in range(1,4)]))

def test_one_whole_pdf_call_and_cached_navigation(tmp_path):
    folder,p=source_project(tmp_path); calls=[];states=[]
    def provider(data,pdf):
        calls.append(data)
        assert pdf==(folder/'source.pdf').read_bytes()
        assert [s['page'] for s in data['physical_pages']]==[1,2,3]
        return output(),{'prompt_tokens':80,'completion_tokens':20,'total_tokens':100,'cost':.001}
    result=NavigationPipeline(folder,p,provider,'test/model',states.append).run()
    assert len(calls)==1 and result['navigation_only']
    assert result['pages'][1]['areas'][0]['area']=='LAB-X7'
    assert result['pages'][1]['views']==['Front elevation']
    assert not any(s['needs_review'] for s in result['pages'])
    assert result['ai_metrics']['input_tokens']==80 and result['ai_metrics']['output_tokens']==20
    assert NavigationPipeline(folder,p,provider,'test/model',lambda _:None).run()==result
    assert len(calls)==1

def test_missing_pages_and_unknown_areas_rejected():
    r=output();r.sheets.pop()
    with pytest.raises(PipelineError): validate_navigation(r,3)
    r=output();r.sheets[0].areas=['invented']
    with pytest.raises(PipelineError): validate_navigation(r,3)

def test_usage_is_reported_before_failed_navigation_validation(tmp_path):
    folder,p=source_project(tmp_path);states=[]
    def provider(data,pdf):
        result=output();result.sheets.pop()
        return result,{'prompt_tokens':90,'completion_tokens':10,'total_tokens':100,'cost':.002}
    with pytest.raises(PipelineError):
        NavigationPipeline(folder,p,provider,'test/model',states.append).run()
    assert states[-1]['requests']==1
    assert states[-1]['input_tokens']==90 and states[-1]['output_tokens']==10
    assert states[-1]['reported_cost_usd']==.002

def test_usage_breakdown_includes_cache_and_pdf_parser_cost():
    metrics=usage_metrics(dict(
        prompt_tokens=258123,completion_tokens=12727,total_tokens=270850,cost=1.014576,
        prompt_tokens_details=dict(cached_tokens=0,cache_write_tokens=258120),
        cost_details=dict(upstream_inference_cost=.772576,upstream_inference_prompt_cost=.645306,upstream_inference_completions_cost=.12727)))
    assert metrics['cache_write_tokens']==258120
    assert metrics['input_cost_usd']==.645306 and metrics['output_cost_usd']==.12727
    assert metrics['pdf_parser_cost_usd']==pytest.approx(.242)

def test_provider_does_not_require_unsupported_temperature(monkeypatch):
    captured={}
    class Response:
        def raise_for_status(self): pass
        def json(self): return {'choices':[{'message':{'content':output().model_dump_json()}}]}
    def post(*args,**kwargs): captured.update(kwargs);return Response()
    monkeypatch.setattr('backend.navigation.httpx.post',post)
    NavigationProvider('private','openai/gpt-5.6-sol')({'page_count':3},b'%PDF-test')
    assert captured['json']['provider']['require_parameters'] is True
    assert 'temperature' not in captured['json']

def test_upload_uses_navigation_pipeline(client,monkeypatch):
    from backend import main
    from tests.test_app import pdf_bytes,wait_done
    monkeypatch.setattr(main,'Pipeline',NavigationPipeline)
    monkeypatch.setattr(main,'OpenRouter',lambda k,m:lambda data,pdf:(output(),{}))
    monkeypatch.setenv('OPENROUTER_API_KEY','test-key')
    r=client.post('/api/projects',files={'file':('Other.pdf',pdf_bytes(),'application/pdf')})
    pid=r.json()['id'];assert wait_done(client,pid)['status']=='ready_to_generate'
    assert client.post('/api/projects/'+pid+'/generate').status_code==202
    assert wait_done(client,pid)['status']=='complete'
    assert client.get('/api/projects/'+pid).json()['navigation_only']

from tests.test_app import client
