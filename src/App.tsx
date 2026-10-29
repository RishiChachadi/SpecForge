import { useEffect, useState, useRef } from "react";
import { call } from "./api";
import Settings from "./Settings";

export type Role = "Author" | "Reviewer" | "HOD";

export default function App() {
  const [open, setOpen] = useState(false);
  const [health, setHealth] = useState("checking...");
  const [role, setRole] = useState<Role>("Author");
  
  const [specFile, setSpecFile] = useState<File | null>(null);
  const [blueprintFile, setBlueprintFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [parsedData, setParsedData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    call<{ status: string }>("/health")
      .then((d) => setHealth(d.status))
      .catch(() => setHealth("server not reachable"));
  }, []);

  const handleParse = async () => {
    if (!specFile) {
      setError("Please upload the main course specification document.");
      return;
    }
    
    setLoading(true);
    setError(null);
    setParsedData(null);
    
    const formData = new FormData();
    formData.append("spec", specFile);
    if (blueprintFile) formData.append("blueprint", blueprintFile);
    
    try {
      const data = await call<any>("/parse", {
        method: "POST",
        body: formData
      });
      setParsedData(data);
    } catch (err: any) {
      setError(err.message || "Failed to parse files.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <header className="bar">
        <h1>SpecForge - Course Specification Builder</h1>
        <span className="pill">Server: {health}</span>
        <label className="role-switcher" aria-label="Role">
          <span>Role:</span>
          <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
            <option value="Author">Author</option>
            <option value="Reviewer">Reviewer</option>
            <option value="HOD">HOD</option>
          </select>
        </label>
        <button type="button" onClick={() => fileInputRef.current?.click()}>
          Upload files
        </button>
        <button className="ghost" onClick={() => setOpen(true)} aria-label="Settings">
          ⚙ Settings
        </button>
      </header>
      <main>
        <div className="card" style={{ marginBottom: "20px" }}>
          <h2>File Upload</h2>
          <div className="row" style={{ flexDirection: "column", gap: "12px" }}>
            <label>
              <strong>1. Course Specification (.docx) *Required</strong>
              <input 
                type="file" 
                accept=".docx,.doc,.pdf,.html" 
                onChange={(e) => setSpecFile(e.target.files?.[0] || null)} 
                ref={fileInputRef}
              />
            </label>
            <label>
              <strong>2. Question Blueprint (.doc) *Optional</strong>
              <input 
                type="file" 
                accept=".docx,.doc,.pdf,.html" 
                onChange={(e) => setBlueprintFile(e.target.files?.[0] || null)} 
              />
            </label>
            <button 
              onClick={handleParse} 
              disabled={!specFile || loading}
              style={{ width: "fit-content" }}
            >
              {loading ? "Parsing with AI..." : "Extract Course Data"}
            </button>
            {error && <p className="bad">{error}</p>}
          </div>
        </div>

        {parsedData && (
          <div className="card">
            <h2>Extracted Course Details</h2>
            <div className="row" style={{ gap: "20px", marginBottom: "20px" }}>
              <div><strong>Title:</strong> {parsedData.course.title}</div>
              <div><strong>Code:</strong> {parsedData.course.code}</div>
              <div><strong>Credits:</strong> <span className="pill">{parsedData.course.credits_ltp}</span></div>
              <div><strong>COs Found:</strong> {parsedData.course_outcomes.length}</div>
              <div><strong>Units Found:</strong> {parsedData.units.length}</div>
            </div>
            
            <details style={{ background: "#f8fafc", padding: "12px", borderRadius: "6px", border: "1px solid #e2e8f0" }}>
              <summary style={{ cursor: "pointer", fontWeight: 500 }}>View Raw JSON Extract</summary>
              <pre style={{ overflowX: "auto", fontSize: "0.85rem", marginTop: "12px" }}>
                {JSON.stringify(parsedData, null, 2)}
              </pre>
            </details>
          </div>
        )}
      </main>
      {open && <Settings onClose={() => setOpen(false)} />}
    </>
  );
}