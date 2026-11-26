#!/usr/bin/env python3
"""Build a deterministic Unity source kit; no Unity installation is required."""
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'downloads' / 'TrontPhysicsGym-Unity.zip'


def entries():
    for source in sorted((ROOT / 'unity' / 'Assets').rglob('*')):
        if source.is_file():
            yield source.relative_to(ROOT / 'unity').as_posix(), source.read_bytes()
    for target, source in [
        ('README.md', 'unity/README.md'),
        ('IMPLEMENTATION.md', 'unity/implementation-notes.md'),
        ('LICENSE', 'LICENSE'),
        ('THIRD_PARTY_NOTICES.md', 'THIRD_PARTY_NOTICES.md'),
        ('Reference/PROVENANCE.json', 'upstream/PROVENANCE.json'),
    ]:
        yield target, (ROOT / source).read_bytes()
    tutorial = (ROOT / 'tutorial/tutorial.md').read_text()
    tutorial = tutorial.replace('(../downloads/', '(https://tront.xyz/pid/downloads/')
    tutorial = tutorial.replace('(../vr/)', '(https://tront.xyz/pid/vr/)')
    tutorial = tutorial.replace('(../)', '(https://tront.xyz/pid/)')
    tutorial = tutorial.replace('(../unity/', '(https://github.com/TrentSterling/pid/blob/main/unity/')
    yield 'TUTORIAL.md', tutorial.encode()
    for source in sorted((ROOT / 'upstream' / 'GorillaLocomotion').iterdir()):
        if source.is_file():
            yield f'Reference/GorillaLocomotion/{source.name}', source.read_bytes()


def build():
    OUT.parent.mkdir(exist_ok=True)
    count = 0
    with ZipFile(OUT, 'w', compression=ZIP_DEFLATED, compresslevel=9) as archive:
        for name, data in entries():
            info = ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
            info.compress_type = ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            archive.writestr(info, data, compress_type=ZIP_DEFLATED, compresslevel=9)
            count += 1
    print(f'{OUT.relative_to(ROOT)}: {count} files, {OUT.stat().st_size:,} bytes')


if __name__ == '__main__':
    build()
