"""Local Wakajaye tenant portal. Run with python3 server.py."""
import base64, hashlib, hmac, json, os, re, secrets, time
from datetime import datetime, date
from contextlib import contextmanager
from urllib.request import Request, urlopen
from http.cookies import SimpleCookie
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit, parse_qs, quote
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent
ADMIN = os.getenv('WAKAJAYE_ADMIN_EMAIL', '').strip().lower()
PORT = int(os.getenv('PORT', '8000'))
ORIGIN = f'http://127.0.0.1:{PORT}'
EMAIL = re.compile(r'[^\s@]+@[^\s@]+\.[^\s@]+')
MAX_FILE = 3 * 1024**2
os.umask(0o077)


class Database:
    def __init__(self, connection):
        self.connection = connection

    def commit(self):
        self.connection.commit()
        self.connection.execute('SET LOCAL search_path TO wakajaye, pg_catalog')

    def execute(self, statement, parameters=()):
        return self.connection.execute(statement.replace('?', '%s'), parameters)


@contextmanager
def db():
    dsn = os.getenv('SUPABASE_DB_URL')
    if not dsn:
        raise InputError('The tenant database is unavailable.', 503)
    try:
        import psycopg
        from psycopg.rows import dict_row
    except ImportError:
        raise InputError('The tenant database driver is unavailable.', 503) from None
    try:
        with psycopg.connect(dsn, row_factory=dict_row, connect_timeout=5, sslmode='require') as connection:
            connection.execute('SET LOCAL search_path TO wakajaye, pg_catalog')
            yield Database(connection)
    except psycopg.Error as error:
        print(f'Database operation failed ({type(error).__name__}).', flush=True)
        raise InputError('The tenant database is unavailable.', 503) from None


def digest(s):
    return hashlib.sha256(s.encode()).hexdigest()


def mail(to, subject, body, attachment=None):
    key, sender = os.getenv('BREVO_API_KEY'), os.getenv('BREVO_FROM_EMAIL')
    if not key or not sender:
        raise InputError('Email delivery is unavailable. Contact the hostel for help.', 503)
    payload = {
        'sender': {'name': 'Wakajaye', 'email': sender},
        'to': [{'email': to}],
        'subject': subject,
        'textContent': body,
    }
    if attachment:
        payload['attachment'] = [{
            'name': 'wakajaye-rent-receipt.txt',
            'content': base64.b64encode(attachment.encode()).decode('ascii'),
        }]
    request = Request(
        'https://api.brevo.com/v3/smtp/email',
        data=json.dumps(payload).encode(),
        headers={'api-key': key, 'Content-Type': 'application/json'},
        method='POST',
    )
    with urlopen(request, timeout=15) as response:
        if response.status != 201:
            raise InputError('Email delivery failed. Try again.', 502)


class InputError(Exception):
    def __init__(self, msg, status=400):
        self.msg, self.status = msg, status


def field(d, key, limit=120):
    s = d.get(key)
    if not isinstance(s, str) or not (s := s.strip()) or len(s) > limit or any(ord(c)<32 for c in s):
        raise InputError(f'Enter a valid {key}.')
    return s


def email_field(d):
    s = field(d, 'email', 254).lower()
    if not EMAIL.fullmatch(s):
        raise InputError('Enter a valid email address.')
    return s


def user(con, email):
    if not email:
        return None
    row = con.execute('SELECT * FROM tenants WHERE email=?', (email,)).fetchone()
    if row is None:
        return None
    receipt = con.execute('SELECT name,status FROM receipts WHERE email=?', (email,)).fetchone()
    return {'email': email, 'admin': email == ADMIN, **json.loads(row['profile'] or '{}'),
            'guarantor': bool(row['guarantor']), 'rent': json.loads(row['rent'] or 'null'),
            'receipt': dict(receipt) if receipt else None}


class Handler(SimpleHTTPRequestHandler):
    origin = ORIGIN

    def __init__(self, *a, **kw):
        super().__init__(*a, directory=str(ROOT / 'dist'), **kw)

    def end_headers(self):
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'no-referrer')
        self.send_header('Content-Security-Policy', "default-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
        super().end_headers()

    def reply(self, data, status=200, cookie=None):
        blob = json.dumps(data).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Cache-Control', 'no-store')
        if cookie is not None:
            secure = '; Secure' if self.origin.startswith('https://') else ''
            self.send_header('Set-Cookie', f'wj={cookie}; Path=/; HttpOnly; SameSite=Strict; Max-Age={604800 if cookie else 0}{secure}')
        self.send_header('Content-Length', str(len(blob)))
        self.end_headers()
        self.wfile.write(blob)

    def do_GET(self):
        if self.path.startswith('/api/'):
            self.run_api()
        elif urlsplit(self.path).path in ('/', '/index.html', '/style.css', '/app.js', '/canvas.webp', '/hostel.jpg', '/Trap-Regular.otf', '/Trap-Semibold.otf', '/wordmark.svg'):
            super().do_GET()
        else:
            self.send_error(404)

    def do_POST(self):
        self.run_api()

    def run_api(self):
        try:
            if self.headers.get('Host') != urlsplit(self.origin).netloc:
                raise InputError('Open the portal at ' + self.origin, 403)
            d = {}
            if self.command == 'POST':
                if self.headers.get('Origin') != self.origin or self.headers.get_content_type() != 'application/json':
                    raise InputError('Request origin is not allowed.', 403)
                size = int(self.headers.get('Content-Length', '0'))
                if not 0 < size <= 4_300_000:
                    raise InputError('Invalid request size.', 413)
                d = json.loads(self.rfile.read(size))
                if not isinstance(d, dict):
                    raise InputError('Invalid request.')
            cookies = SimpleCookie(self.headers.get('Cookie', ''))
            token = digest(cookies['wj'].value) if 'wj' in cookies else ''
            if self.command == 'GET' and urlsplit(self.path).path == '/api/session' and not token:
                return self.reply({'user': None})
            with db() as con:
                session = con.execute('SELECT email FROM sessions WHERE token=? AND expires>?', (token,time.time())).fetchone()
                email = session['email'] if session else None
                path = urlsplit(self.path)
                if self.command == 'GET':
                    if path.path == '/api/session':
                        return self.reply({'user':user(con,email)})
                    if not email or email != ADMIN:
                        raise InputError('Admin access required.',403)
                    if path.path == '/api/queue':
                        rows = con.execute("SELECT r.id,r.email,t.rent FROM receipts r JOIN tenants t USING(email) WHERE r.status='pending'")
                        return self.reply({'queue':[{'id':r['id'],'email':r['email'],**{k:json.loads(r['rent'])[k] for k in ('amount','paid')}} for r in rows]})
                    if path.path == '/api/file':
                        r = con.execute('SELECT * FROM receipts WHERE id=?',(parse_qs(path.query).get('id',[''])[0],)).fetchone()
                        if not r:
                            raise InputError('Receipt not found.',404)
                        self.send_response(200)
                        self.send_header('Content-Type', r['mime'])
                        self.send_header('Content-Disposition', "attachment; filename*=UTF-8''" + quote(r['name'],safe=''))
                        self.send_header('Cache-Control','no-store')
                        self.send_header('Content-Length',str(len(r['bytes'])))
                        self.end_headers()
                        return self.wfile.write(r['bytes'])
                    raise InputError('Not found.',404)
                return self.mutate(con,path.path.removeprefix('/api/'),d,email,token)
        except InputError as e:
            self.reply({'error':e.msg},e.status)
        except (ValueError, TypeError):
            self.reply({'error':'Check the information you entered.'},400)
        except OSError:
            self.reply({'error':'Email delivery failed. Try again or check the server’s mail settings.'},502)

    def mutate(self, con, action, d, email, token):
        if action == 'code':
            address = email_field(d)
            mode = d.get('mode')
            if mode not in ('create','signin'):
                raise InputError('Invalid sign-in request.')
            now = time.time()
            con.execute('SELECT pg_advisory_xact_lock(73201300)')
            old = con.execute('SELECT issued FROM codes WHERE email=?',(address,)).fetchone()
            if old and now-old['issued']<30:
                raise InputError('Wait 30 seconds before requesting another code.',429)
            code = str(secrets.randbelow(900000)+100000)
            salt = secrets.token_hex(16)
            hashed = salt + ':' + digest(salt+code)
            con.execute('INSERT INTO codes VALUES(?,?,?,?,?) ON CONFLICT (email) DO UPDATE SET digest=excluded.digest, issued=excluded.issued, attempts=excluded.attempts, mode=excluded.mode',(address,hashed,now,0,mode))
            mail(address,'Your Wakajaye verification code',f'Your Wakajaye code is {code}. It expires in 10 minutes.')
            con.commit()
            return self.reply({'ok':True})
        if action == 'verify':
            address, code = email_field(d), field(d,'code',6)
            con.execute('SELECT pg_advisory_xact_lock(73201300)')
            row = con.execute('SELECT * FROM codes WHERE email=?',(address,)).fetchone()
            if not row or time.time()-row['issued']>600 or row['attempts']>=5:
                raise InputError('Request a fresh code.')
            salt, expected = row['digest'].split(':',1)
            if not hmac.compare_digest(digest(salt+code),expected):
                con.execute('UPDATE codes SET attempts=attempts+1 WHERE email=?',(address,))
                con.commit()
                raise InputError('That code does not match.')
            exists = user(con,address)
            if row['mode']=='signin' and not exists:
                raise InputError('No account yet. Choose Create an account.')
            con.execute('DELETE FROM codes WHERE email=?',(address,))
            con.execute('INSERT INTO tenants(email) VALUES(?) ON CONFLICT (email) DO NOTHING',(address,))
            con.execute('DELETE FROM sessions WHERE token=? OR expires<?',(token,time.time()))
            new = secrets.token_urlsafe(32)
            con.execute('INSERT INTO sessions VALUES(?,?,?)',(digest(new),address,time.time()+604800))
            con.commit()
            return self.reply({'user':user(con,address)},cookie=new)
        if not email:
            raise InputError('Sign in to continue.',401)
        if action == 'logout':
            con.execute('DELETE FROM sessions WHERE token=?',(token,))
            con.commit()
            return self.reply({'ok':True},cookie='')
        con.execute('SELECT pg_advisory_xact_lock(73201300)')
        current = user(con,email)
        if action == 'profile':
            value = {k:field(d,k,80 if k!='phone' else 30) for k in ('first','last','phone')}
            con.execute('UPDATE tenants SET profile=? WHERE email=?',(json.dumps(value),email))
        elif action == 'guarantor' and current.get('first'):
            value = {k:field(d,k,30 if k=='phone' else 120) for k in ('name','relationship','phone')}
            value['email'] = email_field(d)
            con.execute('UPDATE tenants SET guarantor=? WHERE email=?',(json.dumps(value),email))
        elif action == 'activate' and current['guarantor'] and not current['rent']:
            if d.get('consent')!='on':
                raise InputError('Agree to the tenant consent terms.')
            paid, dob = (date.fromisoformat(field(d,k,10)) for k in ('paid','dob'))
            today = datetime.now(ZoneInfo('Africa/Lagos')).date()
            amount, occupants = float(field(d,'amount',20)), int(field(d,'occupants',3))
            if not (0.01<=amount<=1e9 and amount==round(amount,2) and 1<=occupants<=100 and paid<=today and dob<today):
                raise InputError('Check your payment date, amount, occupant count, and date of birth.')
            value = dict(paid=str(paid),dob=str(dob),amount=amount,occupants=occupants,consent_version=1,consented_at=datetime.now(ZoneInfo('Africa/Lagos')).isoformat())
            con.execute('UPDATE tenants SET rent=? WHERE email=?',(json.dumps(value),email))
        elif action == 'receipt' and current['rent'] and not current['receipt']:
            name = field(d,'name',240).replace('\\','/').split('/')[-1]
            if not name:
                raise InputError('Choose a file with a valid name.')
            blob = base64.b64decode(field(d,'file',4_250_000),validate=True)
            mime = next((m for sig,m in [(b'%PDF-','application/pdf'),(b'\xff\xd8\xff','image/jpeg'),(b'\x89PNG\r\n\x1a\n','image/png')] if blob.startswith(sig)),None)
            if not mime or len(blob)>MAX_FILE:
                raise InputError('Choose a PDF, JPG, or PNG up to 3 MB.')
            con.execute("INSERT INTO receipts(email,name,mime,bytes,status) VALUES(?,?,?,?,'pending')",(email,name,mime,blob))
        elif action == 'approve' and email == ADMIN:
            r = con.execute("SELECT * FROM receipts WHERE id=? AND status='pending'",(d.get('id'),)).fetchone()
            if not r:
                raise InputError('This receipt is no longer waiting for review.',404)
            tenant = user(con,r['email'])
            rent = tenant['rent']
            receipt = f"WAKAJAYE HOSTEL\nOfficial rent receipt WJ-{r['id']:06d}\n\nTenant: {tenant['first']} {tenant['last']}\nPayment date: {rent['paid']}\nAmount received: NGN {rent['amount']:,.2f}\n"
            mail(r['email'],'Your official Wakajaye rent receipt','Your rent payment has been verified. Your official receipt is attached.',receipt)
            con.execute("UPDATE receipts SET status='verified' WHERE id=?",(r['id'],))
        else:
            raise InputError('This action is unavailable.',403)
        con.commit()
        return self.reply({'user':user(con,email)})


if __name__ == '__main__':
    print(f'Wakajaye is available at {ORIGIN}', flush=True)
    ThreadingHTTPServer(('127.0.0.1',PORT),Handler).serve_forever()
