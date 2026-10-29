"""Offline bridge regressions. Uses local HTTP responses through pinned parsers."""
import importlib.util
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

root = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('bridge', root / 'scripts' / 'hiring-radar-bridge.py')
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)
runtime = root / 'data' / 'integrations' / 'hiring-radar'


@unittest.skipUnless((runtime / 'radar' / 'http.py').exists(), 'optional pinned runtime not installed; Node adapter tests still run')
class BridgeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        sys.path.insert(0, str(runtime))
        from radar import http
        cls.http = http

    def feishu(self, mode):
        def response(url, body, **kwargs):
            if body.get('limit') == 1:
                return {'code': 0, 'data': {'job_post_list': [], 'count': 0}}
            if mode == 'failed':
                raise OSError('offline')
            if mode == 'invalid':
                return {'code': 0, 'data': {}}
            offset = body['offset']
            count = 100 if mode in ('capped', 'repeated') else 1
            jobs = [{'id': str(i + (0 if mode == 'repeated' else offset)), 'title': '工程师', 'description': '负责后端开发与维护', 'requirement': '熟悉 Python'} for i in range(count)]
            return {'code': 0, 'data': {'job_post_list': jobs, 'count': 5000 if count == 100 else 1}}
        return response

    def collect(self, mode):
        html = '<script id="js-websiteInfo">' + json.dumps({'website_info': {'path': 'index'}}) + '</script>'
        with patch.object(self.http, 'get_text', return_value=html), patch.object(self.http, 'post_json', side_effect=self.feishu(mode)):
            return bridge.collect(runtime, 'moonshot')

    def test_complete_official_sections(self):
        result = self.collect('ok')
        self.assertTrue(result['complete'])
        self.assertEqual(len(result['jobs']), 1)
        self.assertTrue(result['jobs'][0]['verifiedSections'])

    def test_bad_pages_fail(self):
        for mode in ('failed', 'invalid', 'capped', 'repeated'):
            with self.subTest(mode=mode), self.assertRaises((RuntimeError, OSError)):
                self.collect(mode)

    def test_swallowed_beisen_error_is_not_success(self):
        with patch.object(self.http, 'post_json', side_effect=OSError('offline')):
            with self.assertRaisesRegex(RuntimeError, 'incomplete_page_failure'):
                bridge.collect(runtime, 'dreame')

    def test_moka_uses_the_upstream_supported_page_size(self):
        def response(url, body, **kwargs):
            if body['limit'] > 50:
                return {'code': 102, 'success': False}
            return {'code': 0, 'data': {'jobs': [{'id': 'one', 'title': '工程师', 'jobDescription': '公开岗位描述'}]}}
        with patch.object(self.http, 'post_json', side_effect=response):
            self.assertEqual(len(bridge.collect(runtime, 'yostar')['jobs']), 1)

    def test_explicit_api_failure_with_empty_data_is_not_a_complete_snapshot(self):
        cases=[('yostar',{'code':102,'success':False,'data':{'jobs':[]}}),('dreame',{'Success':False,'Code':500,'Data':[],'Count':0})]
        for key,response in cases:
            with self.subTest(key=key), patch.object(self.http,'post_json',return_value=response):
                with self.assertRaises(RuntimeError):bridge.collect(runtime,key)


if __name__ == '__main__':
    unittest.main()
