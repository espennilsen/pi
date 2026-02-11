/**
 * Simple smoke test for CRM DB operations.
 * Run with: node --import tsx/esm test-db.ts
 */

import { initDb, crmApi } from "./src/db.ts";
import * as fs from "node:fs";

const DB_PATH = "./test-crm.db";

// Clean up old test DB
if (fs.existsSync(DB_PATH)) {
	fs.unlinkSync(DB_PATH);
}

console.log("📊 Testing CRM DB operations...\n");

// Initialize DB (runs migrations + prepares statements)
console.log("🔧 Initializing database...");
initDb(DB_PATH);
console.log("✅ Database ready\n");

// Test operations
try {
	// Create a company
	console.log("🏢 Creating company...");
	const company = crmApi.createCompany({
		name: "Acme Corp",
		website: "https://acme.example",
		industry: "Technology",
	});
	console.log(`  Created: ${company.name} (ID: ${company.id})`);

	// Create a contact
	console.log("\n👤 Creating contact...");
	const contact = crmApi.createContact({
		first_name: "John",
		last_name: "Doe",
		email: "john@acme.example",
		phone: "+1234567890",
		company_id: company.id,
		birthday: "1990-05-15",
		tags: "vip,client",
		notes: "Important customer",
	});
	console.log(`  Created: ${contact.first_name} ${contact.last_name} (ID: ${contact.id})`);
	console.log(`  Company: ${contact.company_name}`);

	// Log an interaction
	console.log("\n💬 Logging interaction...");
	const interaction = crmApi.createInteraction({
		contact_id: contact.id,
		interaction_type: "call",
		summary: "Discussed Q4 roadmap",
		notes: "Follow up in 2 weeks",
	});
	console.log(`  Logged: ${interaction.interaction_type} - ${interaction.summary}`);

	// Create a reminder
	console.log("\n🔔 Creating reminder...");
	const reminder = crmApi.createReminder({
		contact_id: contact.id,
		reminder_type: "birthday",
		reminder_date: "2026-05-15",
		message: "Wish John a happy birthday!",
	});
	console.log(`  Created: ${reminder.reminder_type} on ${reminder.reminder_date}`);

	// Search contacts — basic
	console.log("\n🔍 Searching contacts...");
	const results = crmApi.searchContacts("john");
	console.log(`  Found ${results.length} contact(s)`);

	// Search contacts — full name
	console.log("\n🔍 Testing full-name search...");
	const fullName = crmApi.searchContacts("John Doe");
	console.log(`  "John Doe": ${fullName.length} result(s)`);
	if (fullName.length !== 1 || fullName[0].id !== contact.id) {
		throw new Error(`Expected 1 result for "John Doe", got ${fullName.length}`);
	}

	// Search — reversed name
	const reversed = crmApi.searchContacts("Doe John");
	console.log(`  "Doe John": ${reversed.length} result(s)`);
	if (reversed.length !== 1) {
		throw new Error(`Expected 1 result for "Doe John", got ${reversed.length}`);
	}

	// Search — comma format
	const comma = crmApi.searchContacts("Doe, John");
	console.log(`  "Doe, John": ${comma.length} result(s)`);
	if (comma.length !== 1) {
		throw new Error(`Expected 1 result for "Doe, John", got ${comma.length}`);
	}

	// Search — partial
	const partial = crmApi.searchContacts("john@acme");
	console.log(`  "john@acme": ${partial.length} result(s)`);
	if (partial.length !== 1) {
		throw new Error(`Expected 1 result for email search, got ${partial.length}`);
	}

	// Search — fuzzy (typo)
	console.log("\n🔍 Testing fuzzy search...");
	const fuzzy1 = crmApi.searchContacts("Jon Doe");
	console.log(`  "Jon Doe" (typo): ${fuzzy1.length} result(s)`);
	if (fuzzy1.length !== 1 || fuzzy1[0].id !== contact.id) {
		throw new Error(`Expected fuzzy match for "Jon Doe", got ${fuzzy1.length}`);
	}

	const fuzzy2 = crmApi.searchContacts("Jonh Do");
	console.log(`  "Jonh Do" (typo): ${fuzzy2.length} result(s)`);
	if (fuzzy2.length !== 1) {
		throw new Error(`Expected fuzzy match for "Jonh Do", got ${fuzzy2.length}`);
	}

	const fuzzy3 = crmApi.searchContacts("xyzzy qqq");
	console.log(`  "xyzzy qqq" (no match): ${fuzzy3.length} result(s)`);
	if (fuzzy3.length !== 0) {
		throw new Error(`Expected 0 results for gibberish, got ${fuzzy3.length}`);
	}

	// Get interactions
	console.log("\n📋 Getting interactions...");
	const interactions = crmApi.getInteractions(contact.id);
	console.log(`  Found ${interactions.length} interaction(s)`);

	// Update contact
	console.log("\n✏️  Updating contact...");
	const updated = crmApi.updateContact(contact.id, {
		notes: "Updated notes",
		tags: "vip,client,enterprise",
	});
	console.log(`  Updated tags: ${updated?.tags}`);

	// Create a second contact for relationships
	console.log("\n👤 Creating second contact...");
	const contact2 = crmApi.createContact({
		first_name: "Jane",
		last_name: "Doe",
		email: "jane@acme.example",
		company_id: company.id,
	});
	console.log(`  Created: ${contact2.first_name} ${contact2.last_name} (ID: ${contact2.id})`);

	// Create relationship
	console.log("\n🤝 Creating relationship...");
	const relationship = crmApi.createRelationship({
		contact_id: contact.id,
		related_contact_id: contact2.id,
		relationship_type: "spouse",
	});
	console.log(`  Created: ${relationship.relationship_type} (ID: ${relationship.id})`);

	// Get relationships (tests JOIN with first_name/last_name)
	console.log("\n🤝 Getting relationships...");
	const relationships = crmApi.getRelationships(contact.id);
	console.log(`  Found ${relationships.length} relationship(s)`);
	for (const r of relationships) {
		console.log(`  - ${r.relationship_type}: ${r.first_name} ${r.last_name}`);
	}
	if (!relationships[0].first_name) {
		throw new Error("Relationship missing first_name from JOIN");
	}

	// Get upcoming reminders (tests JOIN with first_name/last_name)
	console.log("\n📅 Getting upcoming reminders...");
	const upcoming = crmApi.getUpcomingReminders(365);
	console.log(`  Found ${upcoming.length} upcoming reminder(s)`);
	for (const r of upcoming) {
		console.log(`  - ${r.reminder_date}: ${r.reminder_type} — ${r.first_name} ${r.last_name}`);
	}
	if (upcoming.length > 0 && !upcoming[0].first_name) {
		throw new Error("Upcoming reminder missing first_name from JOIN");
	}

	// Groups
	console.log("\n📂 Creating group...");
	const group = crmApi.createGroup({ name: "VIP Clients", description: "High-value clients" });
	console.log(`  Created: ${group.name} (ID: ${group.id})`);
	const groups = crmApi.getGroups();
	console.log(`  Total groups: ${groups.length}`);

	// Group membership
	console.log("\n📂 Testing group membership...");
	const added = crmApi.addGroupMember(group.id, contact.id);
	console.log(`  Add John to VIP Clients: ${added}`);
	crmApi.addGroupMember(group.id, contact2.id);
	console.log(`  Add Jane to VIP Clients: true`);

	const members = crmApi.getGroupMembers(group.id);
	console.log(`  Group members: ${members.length}`);
	for (const m of members) {
		console.log(`  - ${m.first_name} ${m.last_name}`);
	}
	if (members.length !== 2) {
		throw new Error(`Expected 2 group members, got ${members.length}`);
	}

	const contactGroups = crmApi.getContactGroups(contact.id);
	console.log(`  John's groups: ${contactGroups.length}`);
	if (contactGroups.length !== 1 || contactGroups[0].name !== "VIP Clients") {
		throw new Error(`Expected 1 group "VIP Clients", got ${JSON.stringify(contactGroups)}`);
	}

	const removed = crmApi.removeGroupMember(group.id, contact2.id);
	console.log(`  Remove Jane from VIP Clients: ${removed}`);
	const membersAfter = crmApi.getGroupMembers(group.id);
	if (membersAfter.length !== 1) {
		throw new Error(`Expected 1 member after removal, got ${membersAfter.length}`);
	}

	// Duplicate detection
	console.log("\n🔍 Testing duplicate detection...");
	const dupes1 = crmApi.findDuplicates({ email: "john@acme.example", first_name: "John" });
	console.log(`  Find by email: ${dupes1.length} match(es)`);
	if (dupes1.length !== 1 || dupes1[0].id !== contact.id) {
		throw new Error(`Expected 1 duplicate by email, got ${dupes1.length}`);
	}
	const dupes2 = crmApi.findDuplicates({ first_name: "John", last_name: "Doe" });
	console.log(`  Find by name: ${dupes2.length} match(es)`);
	if (dupes2.length !== 1) {
		throw new Error(`Expected 1 duplicate by name, got ${dupes2.length}`);
	}
	const dupes3 = crmApi.findDuplicates({ first_name: "Nobody", last_name: "Here" });
	console.log(`  Find non-existent: ${dupes3.length} match(es)`);
	if (dupes3.length !== 0) {
		throw new Error(`Expected 0 duplicates, got ${dupes3.length}`);
	}

	// CSV export
	console.log("\n📊 Testing CSV export...");
	const csv = crmApi.exportContactsCsv();
	const csvLines = csv.split("\n");
	console.log(`  Exported ${csvLines.length - 1} rows (+ header)`);
	console.log(`  Header: ${csvLines[0]}`);
	if (!csvLines[0].includes("first_name")) {
		throw new Error("CSV header missing first_name");
	}
	if (csvLines.length < 3) { // header + 2 contacts
		throw new Error(`Expected at least 3 CSV lines, got ${csvLines.length}`);
	}

	// CSV import
	console.log("\n📊 Testing CSV import...");
	const importCsv = `first_name,last_name,email,company,tags
Alice,Wonder,alice@wonder.example,WonderCo,imported
Bob,Builder,bob@builder.example,,imported
John,Doe,john@acme.example,,duplicate`;

	const importResult = crmApi.importContactsCsv(importCsv);
	console.log(`  Created: ${importResult.created}`);
	console.log(`  Skipped: ${importResult.skipped}`);
	console.log(`  Duplicates: ${importResult.duplicates.length}`);
	console.log(`  Errors: ${importResult.errors.length}`);

	if (importResult.created !== 2) {
		throw new Error(`Expected 2 created, got ${importResult.created}`);
	}
	if (importResult.duplicates.length !== 1) {
		throw new Error(`Expected 1 duplicate, got ${importResult.duplicates.length}`);
	}
	if (importResult.duplicates[0].incoming !== "John Doe") {
		throw new Error(`Expected duplicate to be "John Doe", got "${importResult.duplicates[0].incoming}"`);
	}

	// Verify imported contacts
	const alice = crmApi.searchContacts("Alice", 1);
	if (alice.length !== 1 || alice[0].email !== "alice@wonder.example") {
		throw new Error("Alice not imported correctly");
	}
	console.log(`  Verified Alice: ${alice[0].first_name} ${alice[0].last_name} @ ${alice[0].company_name}`);

	// Verify WonderCo was auto-created
	const wonderCo = crmApi.getCompanies("WonderCo");
	if (wonderCo.length !== 1) {
		throw new Error("WonderCo company was not auto-created during import");
	}
	console.log(`  Verified auto-created company: ${wonderCo[0].name}`);

	// Test CSV with quoted fields
	console.log("\n📊 Testing CSV with quoted fields...");
	const quotedCsv = `first_name,last_name,notes
"Eve","O'Brien","She said ""hello"", then left"`;
	const quotedResult = crmApi.importContactsCsv(quotedCsv);
	console.log(`  Created: ${quotedResult.created}`);
	if (quotedResult.created !== 1) {
		throw new Error(`Expected 1 created from quoted CSV, got ${quotedResult.created}`);
	}
	const eve = crmApi.searchContacts("Eve", 1);
	if (!eve[0].notes?.includes('"hello"')) {
		throw new Error(`Expected notes with escaped quotes, got: ${eve[0].notes}`);
	}
	console.log(`  Verified Eve's notes: ${eve[0].notes}`);

	// Clean up imported contacts
	for (const c of [alice[0], ...crmApi.searchContacts("Bob", 1), eve[0]]) {
		crmApi.deleteContact(c.id);
	}
	for (const co of wonderCo) {
		crmApi.deleteCompany(co.id);
	}

	// Delete operations
	console.log("\n🗑️  Testing deletions...");
	console.log(`  Delete relationship: ${crmApi.deleteRelationship(relationship.id)}`);
	console.log(`  Delete reminder: ${crmApi.deleteReminder(reminder.id)}`);
	console.log(`  Delete interaction: ${crmApi.deleteInteraction(interaction.id)}`);
	console.log(`  Delete group: ${crmApi.deleteGroup(group.id)}`);
	console.log(`  Delete contact2: ${crmApi.deleteContact(contact2.id)}`);
	console.log(`  Delete contact: ${crmApi.deleteContact(contact.id)}`);
	console.log(`  Delete company: ${crmApi.deleteCompany(company.id)}`);

	// Verify deletions
	const remaining = crmApi.getContacts();
	if (remaining.length !== 0) {
		throw new Error(`Expected 0 contacts after deletion, got ${remaining.length}`);
	}

	// List all contacts
	console.log("\n📊 All contacts:");
	const allContacts = crmApi.getContacts();
	console.log(`  Total: ${allContacts.length}`);

	console.log("\n✅ All tests passed!");
} catch (error) {
	console.error("\n❌ Test failed:", error);
	process.exit(1);
}

// Clean up
fs.unlinkSync(DB_PATH);
console.log("\n🧹 Cleaned up test database");
