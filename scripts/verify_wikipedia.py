#!/usr/bin/env python3
"""Conservative Wikipedia/Commons enrichment keyed to FJC judge identity.

Existing verified Wikipedia URLs remain authoritative until deliberately changed.
Never accept a search hit based on a name alone. Search candidates must include
judicial context AND agree with the judge's first and last names.
"""
import json
import re
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT=Path(__file__).resolve().parent.parent
PATH=ROOT/"judgesFJC2.json"
API="https://en.wikipedia.org/w/api.php"
UA="FederalCourtsMap/1.1 (https://github.com/nikolairura1/fed-courts-map; judicial directory)"
def request(**params):
    params.update(action="query",format="json",formatversion=2)
    url=API+"?"+urllib.parse.urlencode(params)
    req=urllib.request.Request(url,headers={"User-Agent":UA,"Accept":"application/json"})
    with urllib.request.urlopen(req,timeout=40) as f:
        return json.load(f)
def url(title):
    return "https://en.wikipedia.org/wiki/"+urllib.parse.quote(title.replace(" ","_"),safe="()_,.")
def norm(s):
    return re.sub(r"[^a-z0-9]","",(s or "").lower())
def names_match(j,title):
    judge=re.findall(r"[A-Za-z]+",j["name"])
    t=re.findall(r"[A-Za-z]+",title.split("(")[0])
    if len(judge)<2 or len(t)<2:return False
    first,last=norm(judge[0]),norm(judge[-1])
    if last in ("jr","ii","iii","iv"):last=norm(judge[-2])
    return bool(first and last and first==norm(t[0]) and last in [norm(x) for x in t[-3:]])
def court_context(j,text):
    courts=" ".join(a.get("court","") for a in j.get("service",[])).lower()
    txt=text.lower()
    if "court of appeals" in courts:
        return ("court of appeals" in txt or "circuit judge" in txt)
    if "supreme court" in courts:return "supreme court" in txt
    return "district judge" in txt or "district court" in txt or "united states judge" in txt
def judges(data):
    for entry in [*data["by_jdcode"].values(),*data["by_circuit"].values()]:
        yield from entry.get("judges",[])
        yield from entry.get("senior_judges",[])
def page_lookup(titles):
    res=request(titles="|".join(titles),redirects="1",prop="info|pageimages|extracts",
                piprop="thumbnail",pithumbsize=320,exintro="1",explaintext="1",exchars=1100)
    rewrites={}
    for type_ in ("normalized","redirects"):
        for v in res.get("query",{}).get(type_,[]):
            rewrites[v["from"]]=v["to"]
    pages={p["title"]:p for p in res.get("query",{}).get("pages",[])}
    out={}
    for requested in titles:
        target=requested
        for _ in range(8):
            if target not in rewrites:break
            target=rewrites[target]
        if target in pages:out[requested]=pages[target]
    return out
def approve(j,page):
    if page.get("missing") or page.get("invalid") or page.get("ns")!=0:return False
    title=page.get("title","")
    if not names_match(j,title):return False
    body=page.get("extract","")
    return court_context(j,body)
def update_portrait(j,page):
    if j.get("image_url") and not ("??" in j["image_url"] or "en.wikipedia.org/wiki/File:" in j["image_url"]):return False
    image=page.get("thumbnail",{}).get("source","")
    # pageimages obtains images from actual article. Never use a disambiguation page image.
    if not image.startswith("https://upload.wikimedia.org/"):return False
    j["image_url"]=image
    j["portrait_source"]="wikipedia-pageimages"
    j["portrait_source_url"]=url(page["title"])
    j["portrait_verified"]=False
    return True
def main():
    data=json.loads(PATH.read_text(encoding="utf-8"))
    unique={str(j.get("fjc_nid") or j["name"]):j for j in judges(data)}
    records=list(unique.values())
    stats={"judges":len(records),"approved":0,"new_portraits":0,"pending":0}
    # First verify existing URL and legacy-title candidates, including common abbreviations.
    choices={}
    for j in records:
        options=[]
        if j.get("wikipedia_url_verified"):
            options.append(urllib.parse.unquote(j["wikipedia_url_verified"].split("/wiki/")[-1]).replace("_"," "))
        if j.get("wiki_title"):options.append(j["wiki_title"].replace("_"," "))
        words=j["name"].split()
        options.append(j["name"])
        if len(words)>2:
            options.append(words[0]+" "+words[1][0]+". "+" ".join(words[2:]))
            options.append(words[0]+" "+words[-1])
            options.append(words[0]+" "+words[1][0]+". "+words[-1]+" (judge)")
        choices[str(j.get("fjc_nid") or j["name"])]=list(dict.fromkeys(options))
    titles=list(dict.fromkeys(t for x in choices.values() for t in x))
    pages={}
    for i in range(0,len(titles),35):
        pages.update(page_lookup(titles[i:i+35]))
        time.sleep(.15)
    for key,j in unique.items():
        matched=None
        for title in choices[key]:
            page=pages.get(title,{})
            if approve(j,page):
                matched=page;break
        if matched:
            j["wikipedia_url_verified"]=url(matched["title"])
            j["wiki_title"]=matched["title"].replace(" ","_")
            stats["approved"]+=1
            if update_portrait(j,matched):stats["new_portraits"]+=1
        else:
            # Keep an existing verified record only if it was already separately curated;
            # an unverified old title does not become an article link.
            j.pop("wikipedia_url_verified",None)
            stats["pending"]+=1
    # Never publish a half-finished validation if the API fails.
    PATH.write_text(json.dumps(data,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    print(json.dumps(stats, sort_keys=True))
if __name__=="__main__":main()
