import { searchProfessor, getProfessorReviews } from './rmp.js';

const name = process.argv.slice(2).join(' ').trim();

(async () => {
  if (!name) {
    console.error('Usage: node dist/prof_lookup_cli.js "Professor Name"');
    process.exit(1);
  }

  const result = await searchProfessor(name);
  if (!result) {
    console.log(JSON.stringify({ found: false, name }));
    process.exit(0);
  }

  const reviews = await getProfessorReviews(result.id);

  console.log(JSON.stringify({
    found: true,
    name,
    rmp: result,
    reviews
  }));
})();