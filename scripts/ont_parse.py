import re, subprocess, glob, json, statistics, functools, sys
def parse_block(codes, toks):
    N=len(codes); T=toks
    @functools.lru_cache(None)
    def f(i,n):  # min cost to split T[i:] into n numbers
        if i==len(T): return (0,()) if n==0 else (1e9,())
        if n==0: return (1e9,())
        best=(1e9,())
        j=i+1
        while True:
            cost=sum(1 for t in T[i+1:j] if t!='000')
            c,rest=f(j,n-1)
            if c+cost<best[0]: best=(c+cost,(int(''.join(T[i:j])),)+rest)
            if j<len(T) and re.fullmatch(r'\d{3}',T[j]): j+=1
            else: break
        return best
    c,vals=f(0,N)
    return list(zip(codes,vals)) if c<1e9 else []
def parse(pdf):
    txt=subprocess.run(['pdftotext','-raw',pdf,'-'],capture_output=True,text=True).stdout
    out=[]
    for m in re.finditer(r'C ?Ó ?D ?I ?G ?O D ?E Z ?O ?N ?A (.*?)\n.*?V ?A ?L ?O ?R \(₡ / m ?²\) ([\d ,\.]+)\n',txt,re.S):
        codes=re.findall(r'\d{3}-\d{2}-[UR]\d{2}',m.group(1))
        toks=m.group(2).replace('.','').replace(',','').split()
        if codes and toks: out+=parse_block(tuple(codes),tuple(toks))
    return out
if __name__=='__main__':
    r=parse(sys.argv[1]);print(len(r),r[:12])
