"""Every provider call uses the actor's monthly USD-limited OpenRouter key."""
from contextlib import contextmanager
import httpx
from fastapi import HTTPException
from backend.accounts import provider_key

def options(kwargs):
    kwargs['headers'] = dict(kwargs.get('headers',{}), Authorization='Bearer '+provider_key())
    return kwargs

def check(response):
    if response.status_code == 402:
        raise HTTPException(429, 'Monthly AI budget reached or provider credits unavailable. Contact your administrator.')

def post(*args, **kwargs):
    response = httpx.post(*args, **options(kwargs))
    check(response)
    return response

@contextmanager
def stream(*args, **kwargs):
    with httpx.stream(*args, **options(kwargs)) as response:
        check(response)
        yield response
