#!/usr/bin/env python3
"""Conservative collection from named, official federal court biography pages.

No face recognition or guessing. Only accept <img> elements explicitly labelled
with the judge's given name and surname on a *.uscourts.gov page.
"""
import json, re, urllib.parse, urllib.request
from html.parser import HTMLParser
from pathlib import Path
ROOT=Path(__file__).resolve().parent.parent
DATA=ROOT/"judgesFJC2.json"
PAGES={
 "13762157":"https://www.ohsd.uscourts.gov/BioByrne",
 "13762108":"https://www.tnwd.uscourts.gov/content/judge-brian-lea",
 "13762122":"https://www.txwd.uscourts.gov/team/andrew-b-davis/",
 "13762108":"https://www.tnwd.uscourts.gov/content/judge-brian-lea",
 "13762124":"https://www.scd.uscourts.gov/Judges/distjudge.asp",
 "13762214":"https://www.txnd.uscourts.gov/judge/judge-kasdin-mitchell",
 "13762136":"https://www.ohnd.uscourts.gov/news/new-district-judge-michael-j-hendershot",
}
class Images(HTMLParser):
    def __init__(self):
        super().__init__();self.images=[]
    def handle_starttag(self,tag,attrs):
        if tag.lower()=="img":self.images.append(dict(attrs))
def get(url):
    req=urllib.request.Request(url,headers={"User-Agent":"FederalCourtsMap/1.0 public-court-portrait-audit"})
    with urllib.request.urlopen(req,timeout=20) as f:return f.read().decode("utf8","replace")
def main():
    data=json.loads(DATA.read_text("utf8"));found={}
    for group in [*data["by_jdcode"].values(),*data["by_circuit"].values()]:
        for j in group.get("judges",[])+group.get("senior_judges",[]):
            if j.get("fjc_nid"):found[str(j["fjc_nid"])]=j
    added=[];needs_review=[]
    for nid,page in PAGES.items():
        j=found.get(nid)
        if not j or (j.get("image_url") and j.get("portrait_verified")):continue
        try:
            p=Images();p.feed(get(page))
            first=re.sub("[^a-z]","",j["name"].split()[0].lower())
            last=re.sub("[^a-z]","",j["name"].split()[-1].lower())
            options=[]
            for image in p.images:
                alt=re.sub("[^a-z]","",(image.get("alt") or "").lower())
                src=urllib.parse.urljoin(page,image.get("src") or "")
                parsed=urllib.parse.urlparse(src)
                if parsed.scheme!="https" or not parsed.hostname or not parsed.hostname.endswith(".uscourts.gov"):continue
                if not re.search(r"\.(jpg|jpeg|png|webp)(\?|$)",parsed.path,re.I):continue
                if first in alt and last in alt:options.append(src)
            if len(set(options))==1:
                src=options[0]
                j.update(image_url=src,portrait_source="federal-court-biography",
                    portrait_source_url=page,portrait_verified=True)
                added.append(j["name"])
            else:needs_review.append({"name":j["name"],"url":page,"candidates":options})
        except Exception as e:needs_review.append({"name":j["name"],"url":page,"error":str(e)[:100]})
    DATA.write_text(json.dumps(data,ensure_ascii=False,indent=2)+"\n",encoding="utf8")
    (ROOT/"official-portrait-discovery.json").write_text(json.dumps({"newly_verified":added,"needs_review":needs_review},indent=2)+"\n")
    print(json.dumps({"newly_verified":added,"needs_review":len(needs_review)}))
if __name__=="__main__":main()
