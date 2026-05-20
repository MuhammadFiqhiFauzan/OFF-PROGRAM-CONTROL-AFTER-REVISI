/*
 * Tujuan: Guard server untuk halaman User & RBAC.
 * Caller: Next.js App Router route `/admin/users`.
 * Dependensi: Better Auth session dan komponen UserManagement.
 * Main Functions: AdminUsersPage.
 * Side Effects: Redirect login/dashboard bila session atau role admin tidak valid.
 */
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import UserManagement from "./UserManagement";

export default async function AdminUsersPage() {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) {
        redirect("/login");
    }

    if (session.user.role !== "admin") {
        redirect("/");
    }

    return <UserManagement />;
}
