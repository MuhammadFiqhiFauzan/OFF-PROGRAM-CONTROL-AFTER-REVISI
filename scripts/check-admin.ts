import { drizzle } from 'drizzle-orm/libsql';
import { createClient } from '@libsql/client';
import { user } from '../db/schema';
import { eq } from 'drizzle-orm';

async function main() {
  const client = createClient({ url: 'file:sqlite.db' });
  const db = drizzle(client);

  const adminUsers = await db.select().from(user).where(eq(user.role, 'admin'));

  console.log('Admin users in database:');
  console.log('========================');
  if (adminUsers.length === 0) {
    console.log('No admin users found.');
  } else {
    adminUsers.forEach((u) => {
      console.log(`Email: ${u.email}`);
      console.log(`Name: ${u.name}`);
      console.log(`Role: ${u.role}`);
      console.log('---');
    });
  }

  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
