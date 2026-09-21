"""Run with python -m backend.bootstrap_admin; password is entered privately."""
import getpass
from dotenv import load_dotenv
from backend import accounts

def main():
    load_dotenv(accounts.DB.parent.parent/'.env')
    email = input('Admin email [papacong@gmail.com]: ').strip() or 'papacong@gmail.com'
    with accounts.db() as con:
        if con.execute("SELECT id FROM users WHERE role='admin'").fetchone():
            print('An administrator already exists. Use the admin app to manage accounts.'); return
    password = getpass.getpass('Admin password (12+ characters): ')
    if len(password)<12: raise SystemExit('Use at least 12 characters.')
    if password != getpass.getpass('Confirm password: '): raise SystemExit('Passwords do not match.')
    result = accounts.supabase('POST','admin/users',dict(email=email,password=password,email_confirm=True,user_metadata={'name':'Workspace Admin'}),admin=True)
    uid = result.get('id') or result['user']['id']
    with accounts.db() as con:
        con.execute("INSERT INTO users(id,email,name,role,monthly_limit) VALUES (?,?,'Workspace Admin','admin',0)",(uid,email))
    print('Administrator created. Sign in at /admin/. Set your monthly budget there after adding OPENROUTER_MANAGEMENT_KEY.')

if __name__ == '__main__': main()
