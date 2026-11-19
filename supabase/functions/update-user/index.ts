import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// Edge Function para que un admin edite a un usuario de su organización:
// email, nombre, rol y CONTRASEÑA. La llama UserManagement.tsx (botón "Editar").
//
// Deploy:  supabase functions deploy update-user

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const ALLOWED_ROLES = ["admin", "worker"];
const MIN_PASSWORD_LENGTH = 6;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return json({ error: "No authorization header" }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const supabaseClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    // 1. Quién llama: debe ser un admin
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser();
    if (userError || !user) {
      return json({ error: "Sesión no válida" }, 401);
    }

    const { data: profile, error: profileError } = await supabaseAdmin
      .from("user_profiles")
      .select("role, organization_id")
      .eq("id", user.id)
      .maybeSingle();

    if (profileError || !profile || profile.role !== "admin") {
      return json({ error: "Solo los administradores pueden editar usuarios" }, 403);
    }

    // 2. Datos a actualizar
    const { user_id, email, password, full_name, role } = await req.json();

    if (!user_id) {
      return json({ error: "Falta el ID del usuario" }, 400);
    }

    const newPassword = typeof password === "string" ? password.trim() : "";
    if (newPassword && newPassword.length < MIN_PASSWORD_LENGTH) {
      return json(
        { error: `La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres` },
        400,
      );
    }

    if (role && !ALLOWED_ROLES.includes(role)) {
      return json({ error: `Rol no válido: ${role}` }, 400);
    }

    // Evita que un admin se quite a sí mismo el rol y se quede sin acceso
    if (user_id === user.id && role && role !== "admin") {
      return json({ error: "No puedes quitarte a ti mismo el rol de admin" }, 400);
    }

    // 3. El usuario destino debe ser de la misma organización
    const { data: targetProfile, error: targetProfileError } = await supabaseAdmin
      .from("user_profiles")
      .select("organization_id")
      .eq("id", user_id)
      .maybeSingle();

    if (targetProfileError || !targetProfile) {
      return json({ error: "Usuario no encontrado" }, 404);
    }

    if (targetProfile.organization_id !== profile.organization_id) {
      return json({ error: "No puedes editar usuarios de otra organización" }, 403);
    }

    // 4. Actualizar Auth (email / contraseña)
    const authUpdates: { email?: string; password?: string; email_confirm?: boolean } = {};
    if (email) {
      authUpdates.email = email;
      authUpdates.email_confirm = true; // aplicar sin pedir confirmación por correo
    }
    if (newPassword) {
      authUpdates.password = newPassword;
    }

    if (Object.keys(authUpdates).length > 0) {
      const { error: authError } = await supabaseAdmin.auth.admin.updateUserById(
        user_id,
        authUpdates,
      );
      if (authError) {
        return json({ error: authError.message }, 400);
      }
    }

    // 5. Actualizar perfil
    const profileUpdates: Record<string, string> = {};
    if (email) profileUpdates.email = email;
    if (full_name !== undefined) profileUpdates.full_name = full_name;
    if (role) profileUpdates.role = role;

    if (Object.keys(profileUpdates).length > 0) {
      const { error: updateError } = await supabaseAdmin
        .from("user_profiles")
        .update(profileUpdates)
        .eq("id", user_id);

      if (updateError) {
        return json({ error: "Error al actualizar el perfil", details: updateError.message }, 500);
      }
    }

    return json({
      success: true,
      password_changed: Boolean(newPassword),
      message: "Usuario actualizado correctamente",
    });
  } catch (error) {
    console.error("Error:", error);
    return json({ error: "Internal server error", details: (error as Error).message }, 500);
  }
});
