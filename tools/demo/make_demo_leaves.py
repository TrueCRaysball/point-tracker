"""Adds fake medical leave data (and small fake documents) to sample/demo-data.json for the demo app.
Run from the repo root: python3 tools/demo/make_demo_leaves.py   (macOS: uses `sips` for the image)"""
import base64, json, os, subprocess, tempfile, uuid

def pdf(lines):
    """A minimal one-page PDF with the given text lines."""
    text = "BT /F1 13 Tf 60 740 Td 16 TL " + " ".join(f"({l.replace('(', '[').replace(')', ']')}) '" for l in lines) + " ET"
    objs = [
        "<< /Type /Catalog /Pages 2 0 R >>",
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
        f"<< /Length {len(text)} >>\nstream\n{text}\nendstream",
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    out, offsets = b"%PDF-1.4\n", []
    for i, o in enumerate(objs, 1):
        offsets.append(len(out))
        out += f"{i} 0 obj\n{o}\nendobj\n".encode()
    xref = len(out)
    out += f"xref\n0 {len(objs) + 1}\n0000000000 65535 f \n".encode()
    out += "".join(f"{o:010d} 00000 n \n" for o in offsets).encode()
    out += f"trailer\n<< /Size {len(objs) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
    return out

def png_from_pdf(lines):
    with tempfile.TemporaryDirectory() as d:
        src, dst = os.path.join(d, "a.pdf"), os.path.join(d, "a.png")
        open(src, "wb").write(pdf(lines))
        subprocess.run(["sips", "-s", "format", "png", "-Z", "700", src, "--out", dst], check=True, capture_output=True)
        return open(dst, "rb").read()

SAMPLE = "SAMPLE DOCUMENT - FOR DEMO ONLY - NOT A REAL RECORD"
files = {}
def doc(name, kind, doc_type, uploaded, lines):
    ext = "png" if kind == "image" else "pdf"
    stored = f"demo-{len(files) + 1:02d}.{ext}"
    body = [SAMPLE, "", *lines]
    files[stored] = base64.b64encode(png_from_pdf(body) if kind == "image" else pdf(body)).decode()
    return {"file": stored, "name": name, "kind": kind, "docType": doc_type, "uploadedAt": uploaded}

uid = lambda: str(uuid.uuid4()).upper()
d = json.load(open("sample/demo-data.json"))
d["entries"] = [e for e in d["entries"] if not e.get("demoLeave")]

# The current occurrence: six sick call-ins in a row; the sixth triggers medical leave.
trigger_id = None
for i, day in enumerate(["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-26"]):
    e = {"id": uid(), "date": day, "type": "callSick", "note": "Back pain" if i == 0 else "", "stringMode": "auto",
         "otherLabel": "", "otherPoints": 0, "otherBreaksString": True, "created": f"2026-10-{19 + i:02d}T10:00:00Z", "demoLeave": True}
    d["entries"].append(e)
    trigger_id = e["id"]

def leave(**kw):
    base = {"id": uid(), "leaveType": "Personal Medical Leave", "status": "Approved", "category": "other", "diagnosis": "",
            "provider": "", "caseNumber": "", "expectedReturn": "", "note": "", "reminders": [], "attachments": [],
            "confirmedAt": kw["startDate"] + "T12:00:00Z", "updatedAt": kw["startDate"] + "T12:00:00Z"}
    base.update(kw)
    return base

d["leaves"] = [
    leave(triggerEntryId=trigger_id, startDate="2026-10-19", triggerDate="2026-10-26", expectedReturn="2026-11-16",
          category="back", diagnosis="Lower back strain", provider="Orlando Health – Dr. Michaels", caseNumber="OH-2026-34872",
          note="Hurt my back lifting at work on 10/18. Seen at Orlando Health on 10/19.\nPlaced on medical leave; follow-up on 11/7.\nExpected to return 11/16 pending clearance.",
          reminders=[{"id": uid(), "label": "Physical Therapy", "date": "2026-11-04"}, {"id": uid(), "label": "Follow-up Appointment", "date": "2026-11-07"}],
          attachments=[
              doc("Doctor's Note - 10-19-26.pdf", "pdf", "Doctor's Note", "2026-10-19", ["Patient: Sample Cast Member", "Diagnosis: Lower back strain", "Off work 10/19/26 through 11/15/26."]),
              doc("Medical Leave Form.pdf", "pdf", "HR Form", "2026-10-20", ["Medical Leave Request", "Leave type: Personal Medical Leave", "Start: 10/19/26   Expected return: 11/16/26"]),
              doc("MRI Results.png", "image", "Test Result", "2026-10-22", ["MRI - Lumbar Spine", "Mild disc bulge L4-L5. No surgery indicated."]),
              doc("Treatment Plan.pdf", "pdf", "Care Plan", "2026-10-22", ["Treatment Plan", "Physical therapy 2x/week for 3 weeks", "Anti-inflammatory medication"]),
              doc("Follow-up Appt - 11-07-26.pdf", "pdf", "Appointment", "2026-10-24", ["Appointment Confirmation", "Dr. Michaels - Friday 11/7/26 at 9:30 AM"]),
          ]),
    leave(startDate="2026-03-12", triggerDate="2026-03-18", returnDate="2026-03-27", expectedReturn="2026-03-27", category="back",
          diagnosis="Back Injury (sciatica)", provider="AdventHealth – Dr. Patel", caseNumber="AH-2026-11873", status="Closed",
          note="Sciatica flare. Cleared to return 3/27 with lifting restrictions for 2 weeks.",
          attachments=[doc("Doctor's Note - 3-12-26.pdf", "pdf", "Doctor's Note", "2026-03-12", ["Diagnosis: Sciatica", "Off work 3/12/26 - 3/26/26."]),
                       doc("Return to Work - 3-27-26.pdf", "pdf", "Return to Work", "2026-03-26", ["Cleared to return 3/27/26.", "No lifting over 25 lbs for 2 weeks."])]),
    leave(startDate="2025-01-08", triggerDate="2025-01-14", returnDate="2025-01-13", category="flu", diagnosis="Influenza (Flu)",
          provider="CentraCare Urgent Care", status="Closed", note="Flu A positive. Back to work 1/13.",
          attachments=[doc("Flu Test Result.png", "image", "Test Result", "2025-01-08", ["Rapid Influenza Test", "Influenza A: POSITIVE"])]),
    leave(startDate="2025-06-02", triggerDate="2025-06-09", returnDate="2025-06-12", category="other", diagnosis="Migraines",
          leaveType="FMLA", status="Denied", note="FMLA request denied - not enough hours worked yet. Points were not protected."),
    leave(startDate="2024-09-03", triggerDate="2024-09-09", returnDate="2024-09-07", category="respiratory", diagnosis="Respiratory Illness",
          provider="Orlando Health – Dr. Nguyen", status="Closed", note="Bronchitis. Inhaler prescribed."),
    leave(startDate="2024-04-14", triggerDate="2024-04-20", returnDate="2024-04-29", category="joint", diagnosis="Knee Injury",
          leaveType="Workers' Comp", provider="Workers' Comp Clinic", caseNumber="WC-2024-0419", status="Closed",
          note="Slipped on a wet floor in the kitchen. Workers' comp claim filed same day.",
          attachments=[doc("Incident Report.pdf", "pdf", "HR Form", "2024-04-14", ["Workplace Incident Report", "Slip on wet floor, right knee."]),
                       doc("Knee Care Plan.pdf", "pdf", "Care Plan", "2024-04-16", ["Rest, ice, compression, elevation", "Re-evaluate 4/26/24"])]),
    leave(startDate="2023-11-06", triggerDate="2023-11-12", returnDate="2023-11-11", category="gi", diagnosis="GI Issues (IBS Flare)",
          provider="Digestive Health Associates", status="Closed"),
    leave(startDate="2023-08-15", triggerDate="2023-08-21", returnDate="2023-08-26", category="injury", diagnosis="Sprained Wrist",
          provider="AdventHealth Urgent Care", status="Approved"),
]
d["attachmentFiles"] = files
json.dump(d, open("sample/demo-data.json", "w"), indent=2)
print(f"{len(d['leaves'])} leaves, {len(files)} documents, {sum(len(v) for v in files.values()) // 1024} KB of fake files")
