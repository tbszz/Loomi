"""Bounded adapter for pinned upstream parsers; never loads upstream agents/plugins.

The upstream Beisen parser can swallow a page failure, and all parsers have
page budgets. Observe their existing _call function so neither becomes a
successful complete snapshot. No website parsing is duplicated here.
"""
import hashlib
import importlib.util
import json
from pathlib import Path
import sys

MANIFEST = Path(__file__).resolve().parents[1] / 'server' / 'hiringRadarSources.json'


def collect(root, key):
    manifest = json.loads(MANIFEST.read_text(encoding='utf-8'))
    company = next((item for item in manifest['companies'] if item['key'] == key), None)
    if company is None:
        raise RuntimeError('unknown_company')
    root = Path(root).resolve()
    for relative, digest in manifest['runtimeFiles'].items():
        filename = (root / relative).resolve()
        if not filename.is_relative_to(root) or hashlib.sha256(filename.read_bytes().replace(b'\r\n', b'\n')).hexdigest() != digest:
            raise RuntimeError('upstream_revision_mismatch')
    sys.path.insert(0, str(root))
    spec = importlib.util.spec_from_file_location('resume_protocol_upstream_parser', root / 'parsers' / (company['parser'] + '.py'))
    parser = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(parser)
    from radar import http
    http.guard_stderr()
    # Bound upstream exponential retries inside the enclosing process budget.
    http.MAX_WAIT = 10
    original = parser._call
    state = {'error': False, 'count': None, 'last_page': None, 'seen': set(), 'sections': {}}
    # Moka rejects limit=100 with code 102. Keep its upstream page size.
    limit = 50 if company['parser'] == 'moka' else 100

    def observed(*args, **kwargs):
        # Feishu tries candidate website paths with limit=1. Those probes are
        # allowed to fail; actual collection pages must never fail silently.
        probe = company['parser'] == 'feishu' and len(args) >= 4 and args[3] == 1
        try:
            data = original(*args, **kwargs)
            if probe:
                return data
            if not isinstance(data, dict):
                raise RuntimeError('invalid_api_response')
            if data.get('success') is False or data.get('Success') is False:
                raise RuntimeError('api_failure_status')
            if company['parser'] == 'feishu':
                if data.get('code') != 0 or not isinstance(data.get('data'), dict):
                    raise RuntimeError('invalid_feishu_response')
                body = data['data']
                posts, total = body.get('job_post_list'), body.get('count')
            elif company['parser'] == 'beisen':
                if ('Code' in data and data['Code'] != 200) or data.get('TipType', 'Success') != 'Success':
                    raise RuntimeError('api_failure_status')
                posts, total = data.get('Data'), data.get('Count')
            else:
                if 'code' in data and data['code'] != 0:
                    raise RuntimeError('api_failure_status')
                body = data.get('data', data) if isinstance(data, dict) else data
                if not isinstance(body, list) and (not isinstance(body, dict) or not any(isinstance(body.get(k), list) for k in ('jobs', 'list'))):
                    raise RuntimeError('invalid_moka_response')
                posts = parser._jobs(data)
                total = body.get('total') if isinstance(body, dict) else None
            if not isinstance(posts, list):
                raise RuntimeError('invalid_page_shape')
            if total is not None:
                if isinstance(total, bool) or not str(total).isdigit():
                    raise RuntimeError('invalid_total')
                state['count'] = int(total)
            state['last_page'] = len(posts)
            for posting in posts:
                identity = str(posting.get('id') or posting.get('JobAdId') or posting.get('Id') or '')
                if not identity or identity in state['seen']:
                    raise RuntimeError('missing_or_repeated_posting_id')
                state['seen'].add(identity)
                if company['parser'] == 'feishu':
                    duty, requirement = posting.get('description'), posting.get('requirement')
                    if isinstance(duty, str) and duty.strip() and isinstance(requirement, str) and requirement.strip():
                        state['sections'][identity] = (duty, requirement)
            return data
        except Exception:
            if not probe:
                state['error'] = True
            raise

    parser._call = observed
    jobs = parser.fetch(*company['params'], company['company'], keyword='', pages=40, limit=limit)
    if state['error'] or state['last_page'] is None:
        raise RuntimeError('incomplete_page_failure')
    if state['count'] is not None and len(state['seen']) < state['count']:
        raise RuntimeError('incomplete_total_not_reached')
    if state['last_page'] >= limit and (state['count'] is None or len(state['seen']) != state['count']):
        raise RuntimeError('incomplete_page_budget')
    if len(jobs) != len(state['seen']):
        raise RuntimeError('incomplete_output')
    for posting in jobs:
        sections = state['sections'].get(str(posting.get('id', '')))
        if sections:
            from radar.schema import strip_html
            duty, requirement = map(strip_html, sections)
            posting.update(jd='工作职责：\n' + duty + '\n\n任职要求：\n' + requirement,
                           requirements=[requirement], verifiedSections=True)
    return {'source': key, 'revision': manifest['revision'], 'complete': True, 'jobs': jobs}


if __name__ == '__main__':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
        result = collect(sys.argv[1], sys.argv[2])
        print(json.dumps(result, ensure_ascii=False))
    except BaseException as error:
        # Avoid forwarding third-party tracebacks or response contents to logs.
        # The bounded error code distinguishes partial collection from outages.
        code = str(error) if type(error) is RuntimeError and str(error).replace('_', '').isalnum() else type(error).__name__
        print(json.dumps({'error': code, 'complete': False}))
        sys.exit(1)
