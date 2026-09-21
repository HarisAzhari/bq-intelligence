"""Supabase identity, server-side sessions, and atomic local monthly quotas."""
import hashlib
import os
import secrets
import sqlite3
import time
from contextvars import ContextVar
from datetime import datetime, timezone
from pathlib import Path
import httpx
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

DB = Path(__file__).resolve().parent.parent / 'data' / 'accounts.sqlite3'
actor = ContextVar('bq_actor', default=None)
router = APIRouter()

def db():
    con = sqlite3.connect(DB, timeout=30)
    os.chmod(DB, 0o600)
    con.row_factory = sqlite3.Row
    con.executescript('''CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,email TEXT NOT NULL,name TEXT NOT NULL,role TEXT NOT NULL DEFAULT 'user',monthly_limit REAL NOT NULL DEFAULT 25,active INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE IF NOT EXISTS project_owners(project_id TEXT PRIMARY KEY,user_id TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS provider_keys(user_id TEXT PRIMARY KEY,key TEXT NOT NULL,hash TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id TEXT NOT NULL,expires REAL NOT NULL);
    CREATE TABLE IF NOT EXISTS usage(user_id TEXT NOT NULL,month TEXT NOT NULL,used INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(user_id,month));''')
    return con

def supabase(method, path, body=None, admin=False):
    key = os.getenv('SUPABASE_SECRET_KEY' if admin else 'SUPABASE_PUBLISHABLE_KEY', '')
    url = os.getenv('SUPABASE_API_URL', '').rstrip('/')
    for suffix in ['/rest/v1', '/auth/v1']:
        if url.endswith(suffix): url = url[:-len(suffix)]
    if not url or not key: raise HTTPException(503, 'Supabase is not configured.')
    headers = {'apikey': key}
    if key.startswith('eyJ'): headers['Authorization'] = 'Bearer ' + key
    try:
        r = httpx.request(method, url + '/auth/v1/' + path, headers=headers, json=body, timeout=20)
    except httpx.HTTPError: raise HTTPException(503, 'Account service is temporarily unavailable.')
    if not r.is_success:
        raise HTTPException(400 if admin else 401, 'Account operation failed. Check the email and password.' if not admin else 'Supabase could not save this account. Check whether the email already exists and the password meets requirements.')
    return r.json() if r.content else {}

def identity(request):
    token = request.cookies.get('bq_session', '')
    with db() as con:
        row = con.execute('SELECT u.* FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.token=? AND s.expires>? AND u.active=1', (hashlib.sha256(token.encode()).hexdigest(), time.time())).fetchone()
    if not row: raise HTTPException(401, 'Please sign in to continue.')
    return dict(row)

def management(method, path='', body=None):
    # Reload only this server-side setting so setup does not need a restart.
    from dotenv import dotenv_values
    key = os.getenv('OPENROUTER_MANAGEMENT_KEY') or dotenv_values(DB.parent.parent/'.env').get('OPENROUTER_MANAGEMENT_KEY')
    if not key: raise HTTPException(503, 'Add OPENROUTER_MANAGEMENT_KEY to the server .env to enable monthly USD budgets.')
    try:
        response = httpx.request(method, 'https://openrouter.ai/api/v1/keys'+path,
            headers={'Authorization':'Bearer '+key},json=body,timeout=20)
        response.raise_for_status()
        return response.json() if response.content else {}
    except (httpx.HTTPError,ValueError): raise HTTPException(503, 'OpenRouter budget service is unavailable. No budget change was applied.')

def provision(uid, limit, active=True):
    with db() as con:
        con.execute('BEGIN IMMEDIATE')
        old = con.execute('SELECT * FROM provider_keys WHERE user_id=?',(uid,)).fetchone()
        body = dict(limit=limit,limit_reset='monthly',include_byok_in_limit=True,disabled=not active)
        if old:
            management('PATCH','/'+old['hash'],body)
        else:
            result = management('POST',body=dict(name='bq-'+uid,**body))
            con.execute('INSERT INTO provider_keys VALUES (?,?,?)',(uid,result['key'],result['data']['hash']))

def usage(user):
    now = datetime.now(timezone.utc)
    reset = datetime(now.year + (now.month == 12), now.month % 12 + 1, 1, tzinfo=timezone.utc)
    used, available = 0.0, False
    with db() as con: key = con.execute('SELECT hash FROM provider_keys WHERE user_id=?',(user['id'],)).fetchone()
    if key:
        try:
            data = management('GET','/'+key['hash'])['data']
            used = float(data.get('usage_monthly',0)) + float(data.get('byok_usage_monthly',0))
            available = True
        except HTTPException: pass
    return dict(**user, used=used, remaining=max(0,user['monthly_limit']-used), resets_at=reset.isoformat(), unit='USD',usage_available=available)

def provider_key():
    uid = actor.get()
    if not uid: raise HTTPException(401, 'AI requests require a signed-in user.')
    with db() as con:
        user = con.execute('SELECT * FROM users WHERE id=? AND active=1',(uid,)).fetchone()
        key = con.execute('SELECT key FROM provider_keys WHERE user_id=?',(uid,)).fetchone()
    if not user: raise HTTPException(403, 'This account no longer has access.')
    if user['monthly_limit'] <= 0: raise HTTPException(429, 'Your monthly AI budget is zero. Contact your administrator.')
    if not key: raise HTTPException(503, 'Your AI budget has not been activated. Contact your administrator.')
    return key['key']

class Login(BaseModel):
    email: str = Field(max_length=254)
    password: str = Field(min_length=1,max_length=200)

@router.post('/api/auth/admin-login')
@router.post('/api/auth/login')
def login(body: Login, request: Request):
    result = supabase('POST','token?grant_type=password',body.model_dump())
    uid = result['user']['id']
    with db() as con:
        user = con.execute('SELECT * FROM users WHERE id=? AND active=1',(uid,)).fetchone()
        if not user: raise HTTPException(403, 'Access has not been provisioned. Contact your administrator.')
        if request.url.path.endswith('/admin-login') and user['role'] != 'admin':
            raise HTTPException(403, 'Administrator access required.')
        token = secrets.token_urlsafe(48)
        con.execute('DELETE FROM sessions WHERE expires<?', (time.time(),))
        con.execute('INSERT INTO sessions VALUES (?,?,?)',(hashlib.sha256(token.encode()).hexdigest(),uid,time.time()+43200))
    response = JSONResponse(usage(dict(user)))
    response.set_cookie('bq_session',token,httponly=True,secure=request.url.scheme=='https',samesite='strict',max_age=43200,path='/')
    return response

@router.post('/api/auth/logout')
def logout(request: Request):
    with db() as con: con.execute('DELETE FROM sessions WHERE token=?',(hashlib.sha256(request.cookies.get('bq_session','').encode()).hexdigest(),))
    response = JSONResponse({'ok':True}); response.delete_cookie('bq_session',path='/'); return response

@router.get('/api/auth/me')
def me(request: Request): return usage(identity(request))

class NewUser(BaseModel):
    email: str = Field(min_length=3,max_length=254,pattern=r'^[^\s@]+@[^\s@]+\.[^\s@]+$')
    name: str = Field(min_length=1,max_length=100)
    password: str = Field(min_length=12,max_length=200)
    monthly_limit: float = Field(default=25,ge=0,le=1000000,allow_inf_nan=False)

class EditUser(BaseModel):
    monthly_limit: float = Field(ge=0,le=1000000,allow_inf_nan=False)
    active: bool = True

@router.get('/api/admin/users')
def users():
    with db() as con: rows = con.execute('SELECT * FROM users ORDER BY name').fetchall()
    return [usage(dict(row)) for row in rows]

@router.post('/api/admin/users',status_code=201)
def create_user(body: NewUser):
    result = supabase('POST','admin/users',dict(email=body.email,password=body.password,email_confirm=True,user_metadata={'name':body.name}),admin=True)
    uid = result.get('id') or result['user']['id']
    try: provision(uid, body.monthly_limit)
    except HTTPException:
        supabase('DELETE','admin/users/'+uid,admin=True)
        raise
    with db() as con: con.execute('INSERT INTO users(id,email,name,monthly_limit) VALUES (?,?,?,?)',(uid,body.email,body.name,body.monthly_limit))
    return {'id':uid}

@router.patch('/api/admin/users/{uid}')
def edit_user(uid: str, body: EditUser):
    if uid == actor.get() and not body.active: raise HTTPException(400,'You cannot suspend your own administrator account.')
    with db() as con:
        if not con.execute('SELECT id FROM users WHERE id=?',(uid,)).fetchone(): raise HTTPException(404,'User not found.')
    provision(uid,body.monthly_limit,body.active)
    with db() as con:
        if not con.execute('UPDATE users SET monthly_limit=?,active=? WHERE id=?',(body.monthly_limit,body.active,uid)).rowcount: raise HTTPException(404,'User not found.')
        if not body.active: con.execute('DELETE FROM sessions WHERE user_id=?',(uid,))
    return {'ok':True}

@router.delete('/api/admin/users/{uid}')
def delete_user(uid: str):
    if uid == actor.get(): raise HTTPException(400,'You cannot remove your own administrator account.')
    with db() as con: key = con.execute('SELECT hash FROM provider_keys WHERE user_id=?',(uid,)).fetchone()
    if key: management('DELETE','/'+key['hash'])
    supabase('DELETE','admin/users/'+uid,admin=True)
    with db() as con:
        con.execute('DELETE FROM provider_keys WHERE user_id=?',(uid,))
        con.execute('DELETE FROM sessions WHERE user_id=?',(uid,))
        con.execute('DELETE FROM users WHERE id=?',(uid,))
    return {'ok':True}


def can_access_project(pid, uid=None):
    with db() as con:
        return con.execute('SELECT 1 FROM project_owners WHERE project_id=? AND user_id=?',(pid,uid or actor.get())).fetchone() is not None

def assign_project(pid, uid):
    with db() as con:
        con.execute('INSERT INTO project_owners VALUES (?,?) ON CONFLICT(project_id) DO UPDATE SET user_id=excluded.user_id',(pid,uid))
