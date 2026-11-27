#!/usr/bin/env python3
"""Source-level deployment checks. This does not claim Unity or headset execution."""
from pathlib import Path
from html.parser import HTMLParser
from urllib.parse import urlsplit, unquote
from zipfile import ZipFile
import hashlib
import importlib.util
import json
import re

ROOT = Path(__file__).resolve().parents[1]


class Page(HTMLParser):
    def __init__(self):
        super().__init__()
        self.ids = set()
        self.links = []
        self.importmaps = []
        self.in_importmap = False

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if 'id' in a:
            assert a['id'] not in self.ids, f'Duplicate HTML id: {a["id"]}'
            self.ids.add(a['id'])
        for key in ('href', 'src'):
            if key in a:
                self.links.append(a[key])
        if tag == 'script' and a.get('type') == 'importmap':
            self.in_importmap = True

    def handle_endtag(self, tag):
        if tag == 'script':
            self.in_importmap = False

    def handle_data(self, data):
        if self.in_importmap and data.strip():
            self.links.extend(json.loads(data).get('imports', {}).values())


def check_link(page, href):
    url = urlsplit(href)
    if url.scheme or url.netloc or not url.path and not url.fragment:
        return
    target = (ROOT / unquote(url.path.lstrip('/')) if url.path.startswith('/')
              else page.parent / unquote(url.path)) if url.path else page
    target = target.resolve()
    assert target.is_relative_to(ROOT), f'Link leaves the site: {page}: {href}'
    if target.is_dir():
        target /= 'index.html'
    assert target.is_file(), f'Missing linked file: {page.relative_to(ROOT)} → {href}'
    if url.fragment and target.suffix == '.html':
        parsed = Page()
        parsed.feed(target.read_text())
        assert unquote(url.fragment) in parsed.ids, f'Missing anchor: {page.relative_to(ROOT)} → {href}'


def main():
    pages = [ROOT / 'index.html', ROOT / 'vr/index.html', ROOT / 'gtag/index.html', ROOT / 'tutorial/index.html']
    for page in pages:
        parsed = Page()
        parsed.feed(page.read_text())
        for link in parsed.links:
            check_link(page, link)
    print('Four entry pages: local links, import maps, anchors and unique IDs checked.')

    tutorial_hash = hashlib.sha256((ROOT / 'tutorial/tutorial.md').read_bytes()).hexdigest()
    assert f'Source SHA-256: {tutorial_hash}' in (ROOT / 'tutorial/index.html').read_text(), 'Tutorial HTML is stale; rebuild it.'

    for module in [*ROOT.glob('*.js'), *ROOT.joinpath('vr').glob('*.js')]:
        source = module.read_text()
        for ref in re.findall(r'(?:from\s*|import\s*\()([\'\"])(\.[^\'\"]+)\1', source):
            path = ref[1].split('?')[0]
            assert (module.parent / path).is_file(), f'Missing module: {module}: {path}'

    provenance = json.loads((ROOT / 'upstream/PROVENANCE.json').read_text())
    for name, expected in provenance['files'].items():
        data = (ROOT / 'upstream' / name).read_bytes()
        actual = hashlib.sha1(b'blob ' + str(len(data)).encode() + b'\0' + data).hexdigest()
        assert actual == expected, f'Upstream source changed: {name}: {actual}'
    print('Pinned GorillaLocomotion reference: all four original Git blob hashes match.')

    spec = importlib.util.spec_from_file_location('package_unity', ROOT / 'scripts/package-unity.py')
    package = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(package)
    expected_entries = dict(package.entries())
    with ZipFile(ROOT / 'downloads/TrontPhysicsGym-Unity.zip') as archive:
        assert not archive.testzip(), 'Corrupt ZIP entry'
        assert set(archive.namelist()) == set(expected_entries), 'ZIP file list is stale'
        for name, data in expected_entries.items():
            assert archive.read(name) == data, f'Stale ZIP content: {name}; rebuild with scripts/package-unity.py'
    print(f'Unity download: {len(expected_entries)} entries match current source byte for byte.')

    for path in (ROOT / 'PUBLIC_ASSETS.txt').read_text().splitlines():
        if not path or path.startswith('#'):
            continue
        target = ROOT / path
        assert target.is_file() and target.stat().st_size, f'Missing public asset: {path}'
        assert ' ' not in path and '..' not in Path(path).parts, f'Invalid verification path: {path}'
    print('All declared public assets exist. Unity runtime/device validation remains a separate acceptance step.')


if __name__ == '__main__':
    main()
