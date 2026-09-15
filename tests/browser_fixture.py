"""Isolated browser QA server. Deterministic AI substitute; NEVER production config.
Run only with: python -m uvicorn tests.browser_fixture:app --port 8001
"""
import os
from pathlib import Path
from backend import main
from tests.test_app import ControlledProvider,pdf_bytes

main.DATA=Path(__file__).resolve().parent.parent/'tmp'/'browser-qa'
main.DATA.mkdir(parents=True,exist_ok=True)
os.environ['OPENROUTER_API_KEY']='test-simulated-provider'
os.environ['OPENROUTER_MODEL']='simulated/qa-only'
main.OpenRouter=lambda key,model:ControlledProvider(area='ATRIUM-W',name='Simulated QA · Campus renewal',level='Mezzanine')
(main.DATA/'qa-upload.pdf').write_bytes(pdf_bytes())
app=main.app
