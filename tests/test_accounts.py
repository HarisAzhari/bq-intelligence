import hashlib
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch, Mock
from fastapi import HTTPException
from fastapi.testclient import TestClient
from backend import accounts, main, metering

class AccountTests(unittest.TestCase):
    def setUp(self):
        tmp=tempfile.TemporaryDirectory();self.addCleanup(tmp.cleanup)
        p=patch.object(accounts,'DB',Path(tmp.name)/'accounts.db');p.start();self.addCleanup(p.stop)
        self.client=TestClient(main.app);self.addCleanup(self.client.close)
        with accounts.db() as con:
            for uid,role in [('member','user'),('owner','admin')]:
                con.execute('INSERT INTO users(id,email,name,role,monthly_limit) VALUES (?,?,?,?,?)',(uid,uid+'@example.com',uid,role,25))
                con.execute('INSERT INTO sessions VALUES (?,?,?)',(hashlib.sha256(uid.encode()).hexdigest(),uid,time.time()+1000))
                con.execute('INSERT INTO provider_keys VALUES (?,?,?)',(uid,'private-'+uid,'hash-'+uid))
    def as_user(self,uid): self.client.cookies.set('bq_session',uid)
    def test_private_api_requires_session(self):
        self.assertEqual(self.client.get('/api/projects').status_code,401)
        self.assertEqual(self.client.get('/api/projects/sample/pdf').status_code,401)
        self.assertEqual(self.client.get('/',follow_redirects=False).status_code,307)
    def test_member_cannot_manage_accounts_or_global_settings(self):
        self.as_user('member')
        self.assertEqual(self.client.get('/api/admin/users').status_code,403)
        self.assertEqual(self.client.put('/api/config',json={'model':'test'}).status_code,403)
    def test_cross_origin_mutations_rejected(self):
        self.as_user('owner')
        self.assertEqual(self.client.post('/api/auth/logout',headers={'Origin':'https://evil.example'}).status_code,403)
    def test_logout_revokes_session(self):
        self.as_user('member')
        self.assertEqual(self.client.post('/api/auth/logout').status_code,200)
        self.assertEqual(self.client.get('/api/auth/me').status_code,401)
    def test_unprovisioned_supabase_identity_denied(self):
        with patch.object(accounts,'supabase',return_value={'user':{'id':'outsider'}}):
            self.assertEqual(self.client.post('/api/auth/login',json={'email':'outsider@example.com','password':'password'}).status_code,403)
    def test_login_cookie_is_http_only_and_strict(self):
        with patch.object(accounts,'supabase',return_value={'user':{'id':'member'}}),patch.object(accounts,'management',return_value={'data':{'usage_monthly':1.25}}):
            response=self.client.post('/api/auth/login',json={'email':'member@example.com','password':'password'})
        self.assertEqual(response.status_code,200)
        self.assertIn('HttpOnly',response.headers['set-cookie']);self.assertIn('SameSite=strict',response.headers['set-cookie'])
        self.assertNotIn('private-member',response.text)
    def test_suspension_revokes_existing_sessions(self):
        self.as_user('owner')
        with patch.object(accounts,'management'):
            self.assertEqual(self.client.patch('/api/admin/users/member',json={'monthly_limit':10,'active':False}).status_code,200)
        self.as_user('member');self.assertEqual(self.client.get('/api/auth/me').status_code,401)
    def test_self_removal_and_suspension_denied(self):
        self.as_user('owner')
        self.assertEqual(self.client.delete('/api/admin/users/owner').status_code,400)
        self.assertEqual(self.client.patch('/api/admin/users/owner',json={'monthly_limit':10,'active':False}).status_code,400)
    def test_monthly_usd_usage_includes_byok(self):
        with patch.object(accounts,'management',return_value={'data':{'usage_monthly':2.50,'byok_usage_monthly':.25}}):
            result=accounts.usage({'id':'member','monthly_limit':25})
        self.assertEqual(result['used'],2.75);self.assertEqual(result['remaining'],22.25)
        self.assertTrue(result['resets_at'].endswith('+00:00'))
    def test_every_provider_call_replaces_shared_key(self):
        token=accounts.actor.set('member');self.addCleanup(accounts.actor.reset,token)
        response=Mock(status_code=200)
        with patch.object(metering.httpx,'post',return_value=response) as post:
            metering.post('https://openrouter.ai/api/v1/chat/completions',headers={'Authorization':'Bearer shared'})
            self.assertEqual(post.call_args.kwargs['headers']['Authorization'],'Bearer private-member')
    def test_no_actor_or_zero_budget_never_calls_provider(self):
        with self.assertRaises(HTTPException): accounts.provider_key()
        token=accounts.actor.set('member');self.addCleanup(accounts.actor.reset,token)
        with accounts.db() as con:con.execute('UPDATE users SET monthly_limit=0 WHERE id="member"')
        with patch.object(metering.httpx,'post') as post,self.assertRaises(HTTPException) as caught:
            metering.post('https://openrouter.ai/api/v1/chat/completions')
        self.assertEqual(caught.exception.status_code,429);post.assert_not_called()
    def test_admin_login_rejects_members_before_creating_session(self):
        with patch.object(accounts,'supabase',return_value={'user':{'id':'member'}}):
            response=self.client.post('/api/auth/admin-login',json={'email':'member@example.com','password':'password'})
        self.assertEqual(response.status_code,403)
        self.assertNotIn('set-cookie',response.headers)
    def test_admin_login_page_public_and_distinct(self):
        response=self.client.get('/admin/login')
        self.assertEqual(response.status_code,200)
        self.assertIn('Administrator sign in',response.text)
        response=self.client.get('/admin/',follow_redirects=False)
        self.assertEqual(response.headers['location'],'/admin/login')
    def test_project_ownership_blocks_all_nested_resources(self):
        accounts.assign_project('aabbccddeeff','member')
        self.as_user('owner')
        for suffix in ['', '/pdf','/pages/1/image','/chats','/spec/pdf']:
            self.assertEqual(self.client.get('/api/projects/aabbccddeeff'+suffix).status_code,404)
        self.assertEqual(self.client.post('/api/projects/aabbccddeeff/generate').status_code,404)
        self.assertEqual(self.client.get('/api/jobs/aabbccddeeff').status_code,404)
        self.assertTrue(accounts.can_access_project('aabbccddeeff','member'))
        self.assertFalse(accounts.can_access_project('aabbccddeeff','owner'))
    def test_project_list_and_jobs_are_filtered(self):
        import json
        root=accounts.DB.parent/'projects';root.mkdir()
        for pid,uid in [('aabbccddeeff','member'),('112233445566','owner')]:
            folder=root/pid;folder.mkdir()
            (folder/'index.json').write_text(json.dumps(dict(id=pid,name=pid,filename='test.pdf',page_count=1)))
            accounts.assign_project(pid,uid)
        self.as_user('member')
        with patch.object(main,'DATA',root),patch.object(main,'JOBS',{'aabbccddeeff':{},'112233445566':{}}):
            response=self.client.get('/api/projects').json()
        self.assertEqual([p['id'] for p in response['projects']],['aabbccddeeff'])
        self.assertEqual(list(response['jobs']),['aabbccddeeff'])
    def test_update_provider_budget_before_local_commit(self):
        self.as_user('owner')
        with patch.object(accounts,'management',side_effect=HTTPException(503,'Unavailable')):
            self.assertEqual(self.client.patch('/api/admin/users/member',json={'monthly_limit':100,'active':True}).status_code,503)
        with accounts.db() as con: self.assertEqual(con.execute('SELECT monthly_limit FROM users WHERE id="member"').fetchone()[0],25)

if __name__=='__main__':unittest.main()
