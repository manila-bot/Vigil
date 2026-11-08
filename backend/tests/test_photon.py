"""Synthetic signed fixtures; these tests never contact Photon."""
import base64
import copy
import hashlib
import hmac
import json
import time

import pytest
from test_api import client, admin
from app.db import connect, now

SECRET = 'whsec_' + base64.b64encode(b'test-key-only').decode()
PHONE = '+15555550123'


@pytest.fixture()
def setup(client, monkeypatch):
    for key, value in {'PHOTON_WEBHOOK_SECRET': SECRET, 'PHOTON_PROJECT_ID': 'project',
                       'PHOTON_SPACE_ID': 'space', 'PHOTON_AGENT_USER_ID': 'agent',
                       'PHOTON_AGENT_HANDLE': '+15555550999', 'PHOTON_TEST_SENDER': PHONE}.items():
        monkeypatch.setenv(key, value)
    a = admin(client)
    uid = client.post('/api/users', headers=a, json={'name': 'IT Test', 'email': 'it@test.local',
        'password': 'test-password-123', 'role': 'responder', 'team_role': 'IT lead',
        'phone': PHONE, 'alert_opt_in': True}).json()['id']
    iid = client.post('/api/incidents', headers=a, json={'title': 'Synthetic incident'}).json()['incident']['id']
    with connect() as c:
        rid = c.execute("INSERT INTO triage_runs(incident_id,status,provider,created_at) VALUES (?,'approved','stub',?)", (iid,now())).lastrowid
        c.execute("INSERT INTO notifications(incident_id,triage_run_id,idempotency_key,channel,recipient_user_id,recipient_label,body,provider,send_status,created_at,updated_at) VALUES (?,?,'test','imessage',?,'test','test','photon','accepted',?,?)",(iid,rid,uid,now(),now()))
        tid = c.execute("INSERT INTO tasks(incident_id,title,created_at,updated_at) VALUES (?,'Synthetic task',?,?)",(iid,now(),now())).lastrowid
    return client, uid, iid, tid


def event(text='ACK', event_id='event-1'):
    sender = dict(id='human',handle=PHONE,kind='person',projectId='project',platform='imessage')
    recipient = dict(id='agent',handle='+15555550999',kind='agent',projectId='project',platform='imessage')
    return dict(id=event_id,type='message.received',source='imessage.photon',data=dict(projectId='project',object=dict(
        id='message-1',projectId='project',platform='imessage',status='received',sentBy=sender,receivedBy=recipient,
        space=dict(id='space',kind='direct',projectId='project',platform='imessage',participantIds=['human','agent']),
        content=dict(type='text',format='plain',text=text))))


def send(c, payload=None, age=0, signature=True, raw=None):
    raw = raw if raw is not None else json.dumps(payload).encode()
    stamp = str(int(time.time())-age)
    sig = base64.b64encode(hmac.new(b'test-key-only', b'delivery.'+stamp.encode()+b'.'+raw,hashlib.sha256).digest()).decode()
    headers = {'webhook-id':'delivery','webhook-timestamp':stamp,'webhook-signature':'v1,'+sig} if signature else {}
    return c.post('/api/webhooks/photon',content=raw,headers=headers)


def test_ack_take_and_retries(setup):
    c, uid, iid, tid = setup
    assert send(c,event()).json()['result'] == 'acknowledged'
    assert send(c,event()).json()['result'] == 'duplicate'
    assert send(c,event(event_id='again')).json()['result'] == 'no_outstanding_alert'
    assert send(c,event(f'TAKE {tid}','take')).json()['result'] == 'claimed'
    assert send(c,event(f'TAKE {tid}','take-again')).json()['result'] == 'task_unavailable'
    d = c.get(f'/api/incidents/{iid}',headers=admin(c)).json()
    assert d['notifications'][0]['acknowledged_at']
    assert d['tasks'][0]['owner_user_id'] == uid
    assert d['tasks'][0]['status'] == 'in_progress'
    assert sum(e['kind']=='alert_acknowledged' for e in d['timeline']) == 1
    assert sum(e['kind']=='task_claimed' for e in d['timeline']) == 1


@pytest.mark.parametrize('text',['hello','PING TEST 2','ACKNOWLEDGE EVERYTHING','TAKE','TAKE abc','TAKE 999999'])
def test_invalid_commands(setup,text):
    c,uid,iid,tid=setup
    assert send(c,event(text)).json()['result'] in ('invalid_command','task_not_authorized')
    with connect() as db:
        assert db.execute('SELECT acknowledged_at FROM notifications').fetchone()[0] is None
        assert db.execute('SELECT owner_user_id FROM tasks').fetchone()[0] is None


@pytest.mark.parametrize('change',[{'active':0},{'role':'admin'},{'team_role':'Litigation lead'},{'alert_opt_in':0},{'phone':'+15555550124'}])
def test_sender_denied(setup,change):
    c,uid,*_=setup
    with connect() as db:
        for key,value in change.items(): db.execute(f'UPDATE users SET {key}=? WHERE id=?',(value,uid))
    assert send(c,event()).json()['result']=='unauthorized_sender'


def test_duplicate_identity(setup):
    c,uid,*_=setup
    with connect() as db:
        db.execute("UPDATE users SET team_role='IT lead',phone=?,alert_opt_in=1 WHERE id=2",(PHONE,))
    assert send(c,event()).json()['result']=='unauthorized_sender'


@pytest.mark.parametrize('field,value',[('projectId','wrong'),('platform','sms'),('status','dispatched'),('receivedBy.id','wrong'),('receivedBy.handle','wrong'),('space.id','wrong'),('space.kind','group'),('space.participantIds',[{}])])
def test_wrong_metadata(setup,field,value):
    c,*_=setup
    p=event(); target=p['data']['object']; parts=field.split('.')
    for part in parts[:-1]: target=target[part]
    target[parts[-1]]=value
    assert send(c,p).status_code==403


def test_signatures_json_and_ignored(setup):
    c,*_=setup
    assert send(c,event(),signature=False).status_code==401
    assert send(c,event(),age=301).status_code==401
    assert send(c,event(),age=-301).status_code==401
    assert c.post('/api/webhooks/photon',content=b'{}',headers={'webhook-id':'x','webhook-timestamp':str(int(time.time())),'webhook-signature':'v1,wrong'}).status_code==401
    assert send(c,raw=b'{').status_code==400
    assert send(c,raw=b'[]').status_code==400
    assert send(c,dict(id='ignored',type='other')).json()['result']=='ignored_event'
    assert send(c,dict(id='ignored',type='other')).json()['result']=='duplicate'


def test_ambiguous_ack_and_cross_incident(setup):
    c,uid,iid,tid=setup
    a=admin(c)
    second=c.post('/api/incidents',headers=a,json={'title':'Second synthetic incident'}).json()['incident']['id']
    with connect() as db:
        code=db.execute('SELECT code FROM incidents WHERE id=?',(iid,)).fetchone()[0]
        task=db.execute("INSERT INTO tasks(incident_id,title,created_at,updated_at) VALUES (?,'Other',?,?)",(second,now(),now())).lastrowid
    assert send(c,event(f'TAKE {task}','other-task')).json()['result']=='task_not_authorized'
    with connect() as db:
        rid=db.execute("INSERT INTO triage_runs(incident_id,status,provider,created_at) VALUES (?,'approved','stub',?)",(second,now())).lastrowid
        db.execute("INSERT INTO notifications(incident_id,triage_run_id,idempotency_key,channel,recipient_user_id,recipient_label,body,provider,send_status,created_at,updated_at) VALUES (?,?,'second','imessage',?,'test','test','photon','accepted',?,?)",(second,rid,uid,now(),now()))
    assert send(c,event()).json()['result'].startswith('ambiguous_ack')
    assert send(c,event(f'ACK {code}','specific')).json()['result']=='acknowledged'
    with connect() as db:
        assert db.execute('SELECT acknowledged_at FROM notifications WHERE incident_id=?',(second,)).fetchone()[0] is None


def test_transaction_rolls_back_on_internal_failure(setup,monkeypatch):
    import app.routers.photon_webhook as receiver
    c,*_=setup
    original=receiver.add_event
    monkeypatch.setattr(receiver,'add_event',lambda *a,**k: (_ for _ in ()).throw(RuntimeError('synthetic failure')))
    assert send(c,event()).status_code==503
    with connect() as db:
        assert db.execute('SELECT acknowledged_at FROM notifications').fetchone()[0] is None
        assert db.execute('SELECT COUNT(*) FROM photon_webhook_events').fetchone()[0]==0
    monkeypatch.setattr(receiver,'add_event',original)
    assert send(c,event()).json()['result']=='acknowledged'


def test_outbound_schema_and_safeguard(setup,monkeypatch):
    import httpx
    from app.notify.photon import _send_photon
    monkeypatch.setenv('PHOTON_API_KEY','synthetic-key')
    def post(url,**kw):
        assert url=='https://api.photon.codes/v1/projects/project/messages'
        assert kw['json']=={'spaceId':'space','senderId':'agent','content':{'type':'text','format':'plain','text':'Generic alert'}}
        assert kw['headers']['Idempotency-Key']=='test-key'
        return httpx.Response(202,json={'id':'outgoing'})
    monkeypatch.setattr(httpx,'post',post)
    assert _send_photon(PHONE,'Generic alert','imessage','test-key')['provider_message_id']=='outgoing'
    with pytest.raises(ValueError): _send_photon('+15555550777','x','imessage','test-key')


def test_ack_cannot_touch_another_recipient(setup):
    from test_api import responder
    c,uid,iid,tid=setup
    with connect() as db:
        db.execute('UPDATE notifications SET recipient_user_id=2')
        nid=db.execute('SELECT id FROM notifications').fetchone()[0]
    assert send(c,event()).json()['result']=='no_outstanding_alert'
    with connect() as db:
        db.execute('UPDATE notifications SET recipient_user_id=?',(uid,))
    assert c.post(f'/api/incidents/{iid}/notifications/{nid}/ack',headers=responder(c)).status_code==403


@pytest.mark.parametrize('change',["UPDATE notifications SET send_status='failed'", "UPDATE triage_runs SET status='draft'", "UPDATE notifications SET provider='stub'", "UPDATE incidents SET status='closed'"])
def test_unactivated_or_simulated_alerts_do_not_authorize(setup,change):
    c,uid,iid,tid=setup
    with connect() as db: db.execute(change)
    assert send(c,event()).json()['result']=='no_outstanding_alert'
    assert send(c,event(f'TAKE {tid}','take')).json()['result']=='task_not_authorized'
