"""Format-independent local preparation; never invents a project directory."""
import threading
from pathlib import Path
import pymupdf as fitz
PDF_LOCK = threading.RLock()
STAGES = ['Overview', 'Unclassified']

def index_pdf(path, project_id, name, progress=None):
    pages=[]
    with PDF_LOCK, fitz.open(path) as doc:
        if doc.needs_pass: raise ValueError('Upload an unlocked PDF.')
        if not 1 <= len(doc) <= 500: raise ValueError('PDF must contain 1–500 pages.')
        for i,page in enumerate(doc):
            text=page.get_text()
            pages.append(dict(page=i+1,title=f'Sheet {i+1}',number='',discipline='Unclassified',stage='Unclassified',levels=[],areas=[],views=[],notes=[],needs_review=True,reviewed=False,source='Pending AI interpretation',text=text,references=[],width=page.rect.width,height=page.rect.height,is_service=False,is_overview=False,is_register=False))
            if progress: progress(i+1,len(doc))
    return dict(id=project_id,name=Path(name).stem,filename=name,page_count=len(pages),overview_page=None,overview_pages=[],areas=[],hotspots=[],pages=pages,stages=['Unclassified'],profile='AI ingestion v2',engine='ai-v2',generation_complete=False,warnings=['Directory generation has not finished. These are source pages, not an AI-generated project structure.'])
