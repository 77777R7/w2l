import sys,re
t=open(sys.argv[1]).read()
t=re.sub(r'[ \t]+',' ',t)
for term in sys.argv[2:]:
    i=t.find(term)
    if i<0: print('NOT FOUND:',term); continue
    print('===',term,'===')
    seg=t[max(0,i-600):i+1400]
    print(seg.replace('\n',' '))
    print()
