#!/usr/bin/env python3
"""Validate Wikipedia pages against the MediaWiki API, never invent article URLs."""
import json
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT=Path(__file__).resolve().parent.parent
DATA=ROOT/"judgesFJC2.json"
def all_judges(data):
    for group in [*data["by_jdcode"].values(),*data["by_circuit"].values()]:
        yield from group.get("judges",[])
        yield from group.get("senior_judges",[])

def lookup(titles):
    params=urllib.parse.urlencode({"action":"query","format":"json","redirects":"1",
        "titles":"|".join(titles),"formatversion":2,"prop":"info"})
    req=urllib.request.Request("https://en.wikipedia.org/w/api.php?"+params,
        headers={"User-Agent":"FederalCourtsMap/1.0 (public-service directory; GitHub nikolairura1/fed-courts-map)"})
    with urllib.request.urlopen(req,timeout=35) as resp:
        return json.load(resp)

def resolve(requested,answer):
    changes={}
    for entry in answer.get("query",{}).get("normalized",[]):
        changes[entry["from"]]=entry["to"]
    for entry in answer.get("query",{}).get("redirects",[]):
        changes[entry["from"]]=entry["to"]
    pages={p["title"]:p for p in answer.get("query",{}).get("pages",[])}
    out={}
    for original in requested:
        title=original
        for _ in range(6):
            if title not in changes:break
            title=changes[title]
        page=pages.get(title)
        if page and not page.get("missing") and not page.get("invalid") and page.get("ns")==0:
            out[original]="https://en.wikipedia.org/wiki/"+urllib.parse.quote(page["title"].replace(" ","_"),safe="()_,")
    return out

def main():
    data=json.loads(DATA.read_text(encoding="utf8"))
    judges=list(all_judges(data))
    # Only accept an exact existing Wikipedia article title or a Wikipedia redirect.
    titles={}
    for j in judges:
        raw=(j.get("wiki_title") or j["name"]).replace("_"," ").strip()
        if raw:titles.setdefault(raw,[]).append(j)
    keys=list(titles)
    verified=0
    failures=[]
    for i in range(0,len(keys),40):
        batch=keys[i:i+40]
        result=None
        for attempt in range(3):
            try:
                result=resolve(batch,lookup(batch))
                break
            except Exception as e:
                if attempt==2:failures.append(str(e))
                else:time.sleep(2**attempt)
        if result is None:continue
        for name in batch:
            for j in titles[name]:
                if name in result:
                    j["wikipedia_url_verified"]=result[name]
                    verified+=1
                else:j.pop("wikipedia_url_verified",None)
        time.sleep(.2)
    if failures:
        raise RuntimeError("Wikipedia API unavailable; refusing partial overwrite: "+str(failures[:3]))
    DATA.write_text(json.dumps(data,indent=2,ensure_ascii=False)+"\n",encoding="utf8")
    print(json.dumps({"judges":len(judges),"verified_wikipedia_urls":verified,"missing_wikipedia_articles":len(judges)-verified}))
if __name__=="__main__":main()
