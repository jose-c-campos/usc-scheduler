import { searchProfessor, getProfessorSummary, getProfessorReviews } from './rmp.js';


(async () => {
    const name = process.argv.slice(2).join(' ').trim();
    if (!name) throw new Error('Usage: ts-node cli.ts "Prof Name"');

    console.log(`🔎 Searching RateMyProfessors for “${name}” (USC)…`);
    const result = await searchProfessor(name);
    if (!result) {
        console.log('   ❌ not found');
        process.exit(0);
    }
    console.log(`ℹ️  teacherId = ${result.id} (school: ${result.schoolName})`);

    const summary = await getProfessorSummary(result.id);
    console.log('📊 summary →', summary);

    const reviews = await getProfessorReviews(result.id);
    console.log(`✍️  pulled ${reviews.length} reviews (first two shown):`);
    console.dir(reviews.slice(0, 2), { depth: null });
})();
