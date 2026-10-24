#!/usr/bin/env python3
"""Verify and extract selected Lantern ZIPs. Standard library only; no deletions."""
import argparse, hashlib, json, pathlib, shutil, stat, zipfile, contextlib

def digest(stream):
 h=hashlib.sha256()
 for b in iter(lambda:stream.read(1024*1024),b''):h.update(b)
 return h.hexdigest()

def main():
 a=argparse.ArgumentParser(description=__doc__)
 a.add_argument('downloads',type=pathlib.Path);a.add_argument('destination',type=pathlib.Path)
 a.add_argument('--index',type=pathlib.Path,default=pathlib.Path(__file__).with_name('Lantern_Revision02_Asset_Index.json'))
 args=a.parse_args();index=json.loads(args.index.read_text())
 if any(p.is_symlink() for p in [args.destination,*args.destination.parents]):raise SystemExit('Symlink destination is unsupported. No files written.')
 target=args.destination.resolve()
 if not index.get('frozen'):raise SystemExit('The supplied index is not a final frozen collection. No files written.')
 sources=[]; planned={}; members=[]; folded={}
 for archive in index['archives']:
  name=archive['file_name'];matches=list(args.downloads.rglob(name))
  if len(matches)!=1:raise SystemExit(f'Expected one {name}, found {len(matches)}. No files written.')
  path=matches[0]
  with path.open('rb') as f:
   if digest(f)!=archive['sha256']:raise SystemExit(f'Archive checksum differs: {name}. No files written.')
  with zipfile.ZipFile(path) as z:
   for info in z.infolist():
    if info.is_dir():continue
    n=pathlib.PurePosixPath(info.filename)
    if n.is_absolute() or '..' in n.parts or '\\' in str(n) or ':' in str(n) or stat.S_ISLNK(info.external_attr>>16):raise SystemExit(f'Unsafe ZIP path: {n}. No files written.')
    if str(n).casefold() in folded and folded[str(n).casefold()]!=str(n):raise SystemExit(f'Case-colliding paths are unsupported: {n}. No files written.')
    folded[str(n).casefold()]=str(n)
    dest=target.joinpath(*n.parts)
    if not dest.resolve().is_relative_to(target):raise SystemExit(f'Path escapes destination: {n}. No files written.')
    if any(p.is_symlink() for p in [dest,*dest.parents]):raise SystemExit(f'Symlink destination is unsupported: {dest}. No files written.')
    with z.open(info) as f:h=digest(f)
    if str(n) in planned and planned[str(n)]!=h:raise SystemExit(f'Conflicting ZIP members: {n}. No files written.')
    if dest.exists():
     if not dest.is_file():raise SystemExit(f'Destination conflicts with a directory: {n}. No files written.')
     with dest.open('rb') as f:
      if digest(f)!=h:raise SystemExit(f'Existing destination differs: {n}. No files written.')
    for par in dest.parents:
     if par==target.parent:break
     if par.exists() and not par.is_dir():raise SystemExit(f'Parent path is a file: {par}. No files written.')
    if str(n) not in planned:members.append((path,info.filename,dest,h))
    planned[str(n)]=h
 # Catch a file being another selected file's parent before writing.
 for n in planned:
  if any(str(parent) in planned for parent in pathlib.PurePosixPath(n).parents):raise SystemExit(f'Conflicting file/directory paths: {n}. No files written.')
 written=0
 with contextlib.ExitStack() as stack:
  opened={}
  for path,name,dest,h in members:
   if dest.exists():continue
   dest.parent.mkdir(parents=True,exist_ok=True)
   if path not in opened:opened[path]=stack.enter_context(zipfile.ZipFile(path))
   with opened[path].open(name) as source,dest.open('xb') as out:shutil.copyfileobj(source,out,1024*1024)
   with dest.open('rb') as f:
    if digest(f)!=h:raise SystemExit(f'Post-write verification failed: {dest}')
   written+=1
 print(f'Verified {len(index["archives"])} archives and {len(planned)} unique files. Wrote {written} files to {target}.')
if __name__=='__main__':main()
