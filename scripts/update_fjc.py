#!/usr/bin/env python3
"""Reconcile map with FJC Article III export; keep manually curated images."""
import csv
import datetime as dt
import io
import json
import re
import urllib.request
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BASE = "https://www.fjc.gov/sites/default/files/history/"
TODAY = dt.date.today().isoformat()
FILES = ("federal-judicial-service", "education", "demographics", "professional-career")
def load_csv(name):
    local = ROOT / "fjc-data" / (name + ".csv")
    if local.exists():
        contents = local.read_text(encoding="utf-8-sig")
    else:
        request = urllib.request.Request(BASE + name + ".csv", headers={"User-Agent":"FederalCourtsMap/1.0 (public judicial data)"})
        with urllib.request.urlopen(request, timeout=90) as result:
            contents = result.read().decode("utf-8-sig")
    return list(csv.DictReader(io.StringIO(contents)))

def norm(s):
    return re.sub(r"[^a-z0-9]", "", (s or "").lower())

def full_name(row):
    bits = [row.get("First Name",""),row.get("Middle Name",""),row.get("Last Name",""),row.get("Suffix","")]
    return " ".join(str(s).strip() for s in bits if str(s).strip())

def service_name(row):
    name=row["Judge Name"]
    return " ".join(p.strip() for p in name.split(",",1)[::-1]) if "," in name else name

def court_key(row):
    name=row["Court Name"]
    typ=row["Court Type"]
    if typ == "Supreme Court":
        return ("circuit","SCOTUS")
    if typ == "U.S. Court of Appeals":
        suffix=name.split("for the ")[-1].replace(" Circuit","").strip()
        words={"First":1,"Second":2,"Third":3,"Fourth":4,"Fifth":5,"Sixth":6,"Seventh":7,
               "Eighth":8,"Ninth":9,"Tenth":10,"Eleventh":11,"District of Columbia":12,"Federal":13}
        return ("circuit",str(words[suffix])) if suffix in words else None
    if typ != "U.S. District Court":
        return None
    if " for the " not in name: return None
    region=name.split(" for the ",1)[1]
    special={"District of Columbia":"District of Columbia","District of Puerto Rico":"Puerto Rico"}
    if region in special: return ("district",special[region])
    match=re.match(r"(Eastern|Western|Northern|Southern|Middle|Central) District of (.+)$",region)
    if match:return ("district",match.group(2)+" "+match.group(1))
    match=re.match(r"District of (.+)$",region)
    if match:return ("district",match.group(1))
    return None


def academic_appointments(career):
    """Keep explicit FJC faculty roles, including their verbatim dates."""
    role=re.compile(r"\b(professor|lecturer|instructor|faculty|teaching fellow|adjunct|visiting scholar|dean of|law school dean)\b", re.I)
    output=[]
    for item in career:
        for part in re.split(r";\s*", item):
            part=part.strip()
            if part and role.search(part) and not any(x["description"]==part for x in output):
                output.append({"description":part,"source":"FJC professional career"})
    return output

def main():
    rows={name:load_csv(name) for name in FILES}
    old=json.loads((ROOT/"judgesFJC2.json").read_text(encoding="utf8"))
    by_district=old.get("by_jdcode",{})
    districts={norm(v.get("district_name")):k for k,v in by_district.items()}
    by_nid=defaultdict(list); by_name=defaultdict(list)
    for group in [*by_district.values(),*old.get("by_circuit",{}).values()]:
        for j in group.get("judges",[])+group.get("senior_judges",[]):
            if j.get("fjc_nid"):by_nid[str(j["fjc_nid"])].append(j)
            by_name[norm(j.get("name"))].append(j)
    demographics={str(d["nid"]):d for d in rows["demographics"]}
    edu=defaultdict(list); careers=defaultdict(list)
    for r in rows["education"]:
        if r.get("School","").strip():
            edu[str(r["nid"])].append({"school":r["School"].strip(),"degree":r.get("Degree","").strip(),
                                      "year":r.get("Degree Year","").strip()})
    for r in rows["professional-career"]:
        if r.get("Professional Career","").strip():
            careers[str(r["nid"])].append(r["Professional Career"].strip())
    output={"91":old.get("91",{}),"last_updated_utc":dt.datetime.now(dt.timezone.utc).isoformat(),
            "source":"Federal Judicial Center, Biographical Directory of Article III Federal Judges (CSV export)",
            "by_jdcode":{},"by_circuit":{},"judicial_status_values":["active","senior","historical"]}
    for key,entry in by_district.items():
        output["by_jdcode"][key]={k:v for k,v in entry.items() if k not in ("judges","senior_judges")}
        output["by_jdcode"][key]["judges"]=[]
        output["by_jdcode"][key]["senior_judges"]=[]
    for key,entry in old["by_circuit"].items():
        output["by_circuit"][key]={k:v for k,v in entry.items() if k not in ("judges","senior_judges")}
        output["by_circuit"][key]["judges"]=[]
        output["by_circuit"][key]["senior_judges"]=[]
    services=defaultdict(list); unmatched=[]; excluded_future=0
    for r in rows["federal-judicial-service"]:
        key=court_key(r)
        if not key:continue
        commission=r.get("Commission Date","").strip()
        if commission and commission>TODAY:
            excluded_future+=1;continue
        term=r.get("Termination Date","").strip()
        if term and term<=TODAY:continue
        if not commission and not r.get("Recess Appointment Date","").strip():
            unmatched.append({"reason":"no commission date","name":r["Judge Name"],"court":r["Court Name"]});continue
        if key[0]=="district":
            code=districts.get(norm(key[1]))
            if code is None:
                unmatched.append({"reason":"district mapping","name":r["Judge Name"],"court":r["Court Name"]});continue
            dest=("district",code)
        else:dest=key
        services[(dest,str(r["nid"]))].append(r)
    for (dest,nid),appointments in services.items():
        dem=demographics.get(nid)
        first=appointments[0]
        name=full_name(dem) if dem else service_name(first)
        old_candidates=by_nid.get(nid) or by_name.get(norm(name)) or []
        prior=old_candidates[0] if old_candidates else {}
        latest=max(appointments,key=lambda r:r.get("Commission Date",""))
        senior=any(a.get("Senior Status Date","").strip() and a["Senior Status Date"]<=TODAY for a in appointments)
        if dest == ("circuit","SCOTUS") and senior:
            continue  # Retired justices are not members of the sitting nine.
        educ=edu.get(nid,[])
        career=careers.get(nid,[])
        judge={k:prior[k] for k in ("image_url","wiki_title","wikipedia_url_verified","portrait_source","portrait_source_url","portrait_verified","portrait_attribution") if prior.get(k)}
        judge.update({"name":name,"status":"Senior" if senior else "Active","appointed_by":latest.get("Appointing President") or "",
                      "assumed_office":latest.get("Commission Date") or latest.get("Recess Appointment Date") or "",
                      "education":"; ".join(f'{x["school"]} ({x["degree"]}{", "+x["year"] if x["year"] else ""})' for x in educ),
                      "education_items":educ,"professional_career":career,"academic_appointments":academic_appointments(career),"fjc_nid":nid,
                      "fjc_jid":dem.get("jid","") if dem else "",
                      "service":[{"court_type":a["Court Type"],"court":a["Court Name"],
                                  "appointing_president":a.get("Appointing President",""),
                                  "commission_date":a.get("Commission Date",""),
                                  "senior_status_date":a.get("Senior Status Date",""),
                                  "termination_date":a.get("Termination Date","")} for a in appointments],
                      "judicial_status":"senior" if senior else "active","court_type":"article_iii"})
        if not judge.get("wiki_title"):judge["wiki_title"]=name.replace(" ","_")
        if dest[0]=="district":
            field="senior_judges" if senior else "judges"
            output["by_jdcode"][dest[1]][field].append(judge)
        else:output["by_circuit"][dest[1]]["judges"].append(judge)
    # Territorial courts are Article IV; FJC Article III exports cannot confirm their entire rosters.
    for key in ("91","92","94"):
        if key in by_district:
            output["by_jdcode"][key]=by_district[key]
            output["by_jdcode"][key]["source_note"]="Territorial court: not covered by Article III FJC export; independently verify"
    # Preserve Guam's legacy top-level data but do not claim it was verified.
    for group in [*output["by_jdcode"].values(),*output["by_circuit"].values()]:
        for key in ("judges","senior_judges"):
            if key in group:group[key].sort(key=lambda j:j["name"])
    counts={"district_active":sum(len(x["judges"]) for x in output["by_jdcode"].values()),
            "district_senior":sum(len(x["senior_judges"]) for x in output["by_jdcode"].values()),
            "appellate_and_scotus":sum(len(x["judges"]) for x in output["by_circuit"].values()),
            "unmatched":unmatched,"excluded_future":excluded_future}
    if counts["district_active"]+counts["district_senior"]<600 or counts["appellate_and_scotus"]<200 or len(unmatched)>10:
        raise RuntimeError("FJC update failed validation: "+json.dumps(counts))
    (ROOT/"judgesFJC2.json").write_text(json.dumps(output,ensure_ascii=False,indent=2)+"\n",encoding="utf8")
    (ROOT/"fjc-audit.json").write_text(json.dumps(counts,indent=2)+"\n",encoding="utf8")
    print(json.dumps({k:v for k,v in counts.items() if k!="unmatched"},indent=2))
if __name__=="__main__":main()
