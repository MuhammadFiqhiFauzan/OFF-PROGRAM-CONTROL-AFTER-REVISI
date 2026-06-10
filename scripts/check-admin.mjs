import { createClient } from '@libsql/client';
const client = createClient({ url: process.env.DATABASE_URL || 'file:sqlite.db' });

const adminUsers = (await client.execute({
  sql: "SELECT id, email, name, role FROM user WHERE role = ? ORDER BY email",
  args: ["admin"],
})).rows;

console.log("Admin users in database:");
console.log("========================");
if (adminUsers.length === 0) {
  console.log("No admin users found.");
} else {
  adminUsers.forEach((u) => {
    console.log(`Email: ${u.email}`);
    console.log(`Name: ${u.name}`);
    console.log(`Role: ${u.role}`);
    console.log(`ID: ${u.id}`);
    console.log("---");
  });
}

process.exit(0);
