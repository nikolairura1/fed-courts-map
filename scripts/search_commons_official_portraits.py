#!/usr/bin/env python3
"""Find official government-made judge photographs in Wikimedia Commons.

Do not conflate a name match with an identity match; require descriptive context,
government source attribution and a public-domain government license. Ambiguous
results are recorded for review rather than automatically accepted.
"""
import html
import json
import re
import time
import urllib.parse
import urllib.request
import urllib.error
from pathlib import Path

ROOT=Path(__file__).resolve().parent.parent
DATA=ROOT/"judgesFJC2.json"
AUDIT=ROOT/"commons-official-portrait-audit.json"
API="https://commons.wikimedia.org/w/api.php"
HEADERS={"User-Agent":"FederalCourtsMap/1.0 (github.com/nikolairura1/fed-courts-map; court portrait provenance)"}
GOV_SOURCE=re.compile(r"judiciary\.senate\.gov|(?:[a-z0-9.-]+\.)?uscourts\.gov|(?:[a-z0-9.-]+\.)?justice\.gov|united states senate judiciary committee|u\.s\. senate judiciary committee|united states district court|u\.s\. district court|united states court of appeals",re.I)
PUBLIC_DOMAIN=re.compile(r"public domain|pd-usgov|pd-us government|pd-usgov-congress",re.I)
def plain(x):
    return html.unescape(re.sub(r"<[^>]+>"," ",str(x or ""))).strip()
def norm(x):
    return re.sub("[^a-z]","",x.lower())
def first_last(name):
    words=re.findall(r"[A-Za-z]+",name)
    while words and words[-1].lower() in ("jr","ii","iii","iv"):
        words.pop()
    return (norm(words[0]),norm(words[-1])) if len(words)>1 else ("","")
def get(q):
    url=API+"?"+urllib.parse.urlencode({
        "action":"query","format":"json","generator":"search",
        "gsrsearch":q,"gsrnamespace":6,"gsrlimit":25,
        "prop":"imageinfo","iiprop":"url|extmetadata","iiurlwidth":280,
        "formatversion":2})
    req=urllib.request.Request(url,headers=HEADERS)
    for attempt in range(5):
        try:
            with urllib.request.urlopen(req,timeout=30) as resp:
                return json.load(resp).get("query",{}).get("pages",[])
        except urllib.error.HTTPError as exc:
            if exc.code != 429 or attempt == 4:raise
            time.sleep(min(60,8*(2**attempt)))
def all_judges(data):
    for group in [*data["by_jdcode"].values(),*data["by_circuit"].values()]:
        yield from group.get("judges",[])
        yield from group.get("senior_judges",[])
def assess(j,pg):
    title=pg.get("title","")
    infos=pg.get("imageinfo",[])
    if not infos:return None
    info=infos[0]
    meta=info.get("extmetadata",{})
    def value(key):return plain(meta.get(key,{}).get("value",""))
    content=" ".join((title,value("ImageDescription"),value("ObjectName"),value("Artist"),value("Credit"),value("Attribution"),value("Source")))
    first,last=first_last(j["name"])
    compact=norm(content)
    # Require *both* names in the file title or description. Also avoid just
    # matching a surname in the author/photographer credit.
    desc=norm(title+" "+value("ImageDescription")+" "+value("ObjectName"))
    if not first or not last or first not in desc or last not in desc:return None
    # A name is not identity: caption has to explicitly reference a judge or
    # government nominations hearing in addition to government provenance.
    if not re.search(r"judg|jurist|nominee|nominat|court|senate|hearing",content,re.I):return None
    if not GOV_SOURCE.search(content):return None
    license_name=" ".join((value("LicenseShortName"),value("UsageTerms"),value("LicenseUrl"),value("Copyrighted")))
    if not PUBLIC_DOMAIN.search(license_name):return None
    file_url=info.get("thumburl") or info.get("url")
    if not file_url or not file_url.startswith("https://upload.wikimedia.org/"):return None
    return {"image_url":file_url,"title":title,"source":"https://commons.wikimedia.org/wiki/"+urllib.parse.quote(title.replace(" ","_"),safe=":()_."),
            "license":value("LicenseShortName"),"credit":value("Artist") or value("Credit")}
def main():
    data=json.loads(DATA.read_text(encoding="utf8"))
    judges={str(j.get("fjc_nid") or j["name"]):j for j in all_judges(data)
            if j.get("assumed_office","")>="2025-01-01"}
    added=[];ambiguous=[];errors=[];none=[]
    for nid,j in judges.items():
        if j.get("image_url"):continue
        first,last=first_last(j["name"])
        if not first or not last:continue
        try:
            pages=get(f'"{first} {last}" judge')
            matches=[v for p in pages if (v:=assess(j,p))]
            # Never select among two photos without review.
            distinct={v["source"]:v for v in matches}
            if len(distinct)==1:
                v=next(iter(distinct.values()))
                j.update(image_url=v["image_url"],portrait_source="federal-government-via-wikimedia-commons",
                         portrait_source_url=v["source"],portrait_attribution=v["credit"],
                         portrait_license=v["license"],portrait_verified=True)
                added.append({"name":j["name"],"source":v["source"]})
            elif distinct:ambiguous.append({"name":j["name"],"candidates":list(distinct.values())})
            else:none.append(j["name"])
        except Exception as e:errors.append({"name":j["name"],"error":str(e)[:150]})
        time.sleep(3)
    if added:DATA.write_text(json.dumps(data,indent=2,ensure_ascii=False)+"\n",encoding="utf8")
    AUDIT.write_text(json.dumps({"added":added,"ambiguous":ambiguous,"no_public_government_image_found":none,"errors":errors},indent=2)+"\n",encoding="utf8")
    print(json.dumps({"added":len(added),"ambiguous":len(ambiguous),"no_match":len(none),"errors":len(errors)}))
if __name__=="__main__":main()
