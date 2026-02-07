// --- RAYMARCH KERNEL (SOVEREIGN ENGINE) ---
// This code is appended to the User's IRMF code.
// It assumes:
// 1. Uniforms are defined (Header).
// 2. fn mainModel4(p: vec3f) -> vec4f is defined (User Code).

struct VertexOutput {
    @builtin(position) pos: vec4<f32>, // Clip Space
    @location(0) uv: vec2<f32>, // Screen UV [-1, 1]
};

@vertex
fn main_vs(@builtin(vertex_index) VertexIndex : u32) -> VertexOutput {
    var out: VertexOutput;
    // Full Screen Quad Triangle Strip trick
    // 0: (-1, -1), 1: (1, -1), 2: (-1, 1), 3: (1, 1)
    var pos = vec2<f32>(
        f32((VertexIndex << 1u) & 2u),
        f32(VertexIndex & 2u)
    );
    var screen_pos = pos * vec2<f32>(2.0, -2.0) + vec2<f32>(-1.0, 1.0);
    
    // Fix: Use a big triangle to cover screen or just a strip
    // Standard big triangle: (-1, -1), (3, -1), (-1, 3)
    let x = f32((VertexIndex & 1u) << 2u);
    let y = f32((VertexIndex & 2u) << 1u);
    // Let's use the standard "3 vertices" trick used in WebGPU samples
    // var grid = vec2<f32>(f32((VertexIndex << 1u) & 2u), f32(VertexIndex & 2u));
    // var pos_final = grid * vec2<f32>(2.0, -2.0) + vec2<f32>(-1.0, 1.0);
    
    // Simpler: Quad with 6 vertices (Triangle List)
    var p = vec2<f32>(0.0);
    if (VertexIndex == 0u) { p = vec2<f32>(-1.0, -1.0); }
    else if (VertexIndex == 1u) { p = vec2<f32>(1.0, -1.0); }
    else if (VertexIndex == 2u) { p = vec2<f32>(-1.0, 1.0); }
    else if (VertexIndex == 3u) { p = vec2<f32>(-1.0, 1.0); }
    else if (VertexIndex == 4u) { p = vec2<f32>(1.0, -1.0); }
    else if (VertexIndex == 5u) { p = vec2<f32>(1.0, 1.0); }
    
    out.uv = p; // [-1, 1]
    out.pos = vec4<f32>(p, 0.0, 1.0);
    return out;
}

fn get_sdf(p: vec3f) -> f32 {
    let m = mainModel4(p);
    // Protocol: Material.w holds the SDF value.
    return m.w; 
}

fn calcNormal(p: vec3f) -> vec3f {
    let e = 0.001;
    let k = vec2f(1.0, -1.0);
    return normalize(
        k.xyy * get_sdf(p + k.xyy * e) +
        k.yyx * get_sdf(p + k.yyx * e) +
        k.yxy * get_sdf(p + k.yxy * e) +
        k.xxx * get_sdf(p + k.xxx * e)
    );
}

@fragment
fn main(in: VertexOutput) -> @location(0) vec4<f32> {
    // 1. Ray Setup
    // We need to transform Screen Space (UV) to Model Space.
    // Clip Coordinates: (uv.x, uv.y, -1, 1) and (uv.x, uv.y, 1, 1) needed?
    // Better: Unproject using Inverse View Projection?
    // We passed u.invModelViewMatrix in Uniforms.
    
    // Let's construct the ray in View Space first (Camera at origin).
    // Perspective Projection factor:
    // tan(FOV/2) ... u.diagonal used for bounds?
    // Let's assume u.projectionMatrix is Perspective.
    // Inverse Project?
    
    // Simplification for Proof of Concept:
    // Assume we passed the correct "Ray Origin" and "Ray Basis" or Inverse Matrix.
    // Using u.invModelView (which transforms View -> Model).
    
    let uv = in.uv; // [-1, 1]
    // 35 degrees FOV assumption or construct from projection?
    // Let's assume standard camera setup.
    let fov = 75.0 * 3.14159 / 180.0;
    let aspect = 1.0; // Assume square for now or pass aspect?
    // rd_view = normalize(vec3(uv * tan(fov/2), -1.0)); // OpenGL looking down -Z
    let half_height = tan(fov * 0.5);
    let half_width = half_height * aspect;
    let rd_view = normalize(vec3f(uv.x * half_width, uv.y * half_height, -1.0));
    
    // ro_view = (0,0,0)
    
    // Transform to Model Space
    // u.invModelView * vec4(ro_view, 1.0) -> ro_model
    // u.invModelView * vec4(rd_view, 0.0) -> rd_model
    
    let ro_model = (u.invModelView * vec4f(0.0, 0.0, 0.0, 1.0)).xyz;
    let rd_model = normalize((u.invModelView * vec4f(rd_view, 0.0)).xyz);
    
    // 2. Sphere Tracing
    var t = 0.0;
    var hit = false;
    for(var i=0; i<128; i++) {
        let p = ro_model + rd_model * t;
        
        // Bounds Check (Sovereign Optimization)
        // If p is way outside bounding box, skip? 
        // Or assumes IRMF model handles it.
        
        let d = get_sdf(p);
        if (d < 0.01) {
            hit = true;
            break;
        }
        t += d;
        if (t > u.diagonal * 2.0) { break; } // Max dist based on model size
    }
    
    if (hit) {
        let p = ro_model + rd_model * t;
        let n = calcNormal(p);
        // Simple lighting
        let lightDir = normalize(vec3f(1.0, 1.0, 1.0));
        let diff = max(dot(n, lightDir), 0.2);
        
        // Get Material Color
        // let mat = mainModel4(p);
        // let col = vec3f(mat.x, mat.y, mat.z) * diff; // If using colors
        // For eiffel tower, materials[0] is solid.
        // Let's just use nice Orange color for the tower.
        let baseCol = vec3f(1.0, 0.5, 0.2);
        
        return vec4f(baseCol * diff, 1.0);
    }
    
    discard; // Transparent background
    // return vec4f(0.05, 0.05, 0.1, 1.0); // Debug background
}
