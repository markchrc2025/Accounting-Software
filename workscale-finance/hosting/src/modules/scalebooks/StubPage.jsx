export default function StubPage({ title, icon }) {
  return (
    <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', height:'100%', gap:12, color:'#64748b', fontFamily:'Inter,sans-serif' }}>
      <div style={{ fontSize:48 }}>{icon}</div>
      <h2 style={{ margin:0, color:'#0f172a', fontSize:20 }}>{title}</h2>
      <p style={{ margin:0, fontSize:13 }}>This module is under development.</p>
    </div>
  );
}
