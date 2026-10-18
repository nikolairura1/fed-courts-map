#!/usr/bin/env python3
"""Audit portraits of judges appointed since 2025, with distinct official-photo status.

Only a human-confirmed official government publication should set portrait_verified.
An image from Wikipedia's page-image API is useful, but not proof it is official.
"""
import datetime as dt
import json
from pathlib import Path
ROOT=Path(__file__).resolve().parent.parent
src=json.loads((ROOT/"judgesFJC2.json").read_text(encoding="utf8"))
judges={}
for court in [*src["by_jdcode"].values(),*src["by_circuit"].values()]:
    for j in [*court.get("judges",[]),*court.get("senior_judges",[])]:
        if j.get("assumed_office","")<"2025-01-01":continue
        nid=str(j.get("fjc_nid") or j["name"])
        judges[nid]=j
report=[]
for nid,j in sorted(judges.items(),key=lambda pair:pair[1]["name"]):
    official=bool(j.get("portrait_verified") and j.get("portrait_source_url"))
    report.append({"fjc_nid":nid,"name":j["name"],"court":j.get("service",[{}])[0].get("court",""),
      "commission":j.get("assumed_office"),"image_url":j.get("image_url"),
      "portrait_source":j.get("portrait_source","legacy-unknown" if j.get("image_url") else None),
      "portrait_source_url":j.get("portrait_source_url"),
      "official_verified":official,
      "status":"official-verified" if official else ("image-unverified" if j.get("image_url") else "missing-image")})
out={"as_of_utc":dt.datetime.now(dt.timezone.utc).isoformat(),"scope":"commission since 2025-01-01",
     "number_of_judges":len(report),
     "with_images":sum(bool(x["image_url"]) for x in report),
     "official_verified":sum(x["official_verified"] for x in report),
     "missing_images":sum(x["status"]=="missing-image" for x in report),
     "judges":report}
(ROOT/"recent-judge-portrait-audit.json").write_text(json.dumps(out,indent=2)+"\n",encoding="utf8")
print(json.dumps({k:v for k,v in out.items() if k!="judges"}))
