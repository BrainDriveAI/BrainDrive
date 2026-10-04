#!/usr/bin/env python3
"""Independent, standard-library package inventory/hash reader. No live authority activation.
The Node importer separately verifies owner signatures and current authority.
"""
import hashlib,json,pathlib,re,sys

def verify(root):
    root=pathlib.Path(root)
    if root.is_symlink(): raise ValueError('package symlink')
    manifest_path=root/'manifest.json'
    if manifest_path.is_symlink() or manifest_path.stat().st_size>100000: raise ValueError('manifest type/size')
    manifest=json.loads(manifest_path.read_text())
    if manifest.get('schema')!=1 or len(manifest.get('files',[]))>1000: raise ValueError('unsupported schema')
    seen=set(); records={}
    for entry in manifest['files']:
        name=entry['path']
        if not re.fullmatch(r'(authority|messaging)\.json|memory/[a-zA-Z0-9_-]{1,100}\.json',name) or name in seen: raise ValueError('unsafe or duplicate path')
        seen.add(name); path=root/name
        if path.is_symlink() or path.parent.is_symlink() or not path.is_file() or path.stat().st_size>1000000: raise ValueError('file type/size')
        data=path.read_bytes()
        if len(data)!=entry['bytes'] or hashlib.sha256(data).hexdigest()!=entry['sha256']: raise ValueError('hash or size mismatch')
        records[name]=json.loads(data)
    actual={str(p.relative_to(root)) for p in root.rglob('*') if p.is_file() and p.name!='manifest.json'}
    if actual!=seen or 'authority.json' not in seen: raise ValueError('inventory mismatch')
    return {'schema':1,'filesVerified':len(seen),'memoryRecords':len([x for x in seen if x.startswith('memory/')]),'authorityActivation':'none','ownerSignature':'not verified by this reader','dependencies':manifest['dependencies'],'recordPaths':sorted(records)}

if __name__=='__main__':
    try: print(json.dumps(verify(sys.argv[1]),indent=2))
    except (ValueError,KeyError,OSError,IndexError) as error:
        print(json.dumps({'error':str(error)}),file=sys.stderr);sys.exit(1)
