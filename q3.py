import re,html,sys
s=open(sys.argv[1],encoding='utf-8',errors='replace').read()
s=re.sub(r'<script.*?</script>','',s,flags=re.S)
s=re.sub(r'<style.*?</style>','',s,flags=re.S)
t=html.unescape(re.sub(r'<[^>]+>','',s))
t=re.sub(r'[ \t]+',' ',t)
open('/tmp/reimerdes.txt','w').write(t)
print('chars',len(t))
for term in ['Sony was a suit','no application here','fundamentally altered','crystal clear','Sony test','capab']:
    i=t.find(term)
    print(term,'->',i)
