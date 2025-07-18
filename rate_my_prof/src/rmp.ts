/* src/rmp.ts --------------------------------------------------------------- */
import fetch from 'cross-fetch';
import { SEARCH_TEACHERS, TEACHER_RATINGS_PAGE } from './graphql.js';

const ENDPOINT = 'https://www.ratemyprofessors.com/graphql';

// Main and sub-school IDs for USC
const SCHOOL_IDS = [
  { name: "University of Southern California", id: "U2Nob29sLTEzODE=" }, // main
  { name: "USC School of Dentistry", id: "U2Nob29sLTU5OTk=" },
  { name: "USC School of Medicine", id: "U2Nob29sLTExOTI1" },
  { name: "USC School of Law", id: "U2Nob29sLTEzMTAz" },
  { name: "USC School of Pharmacy", id: "U2Nob29sLTU1MDc=" },
  { name: "USC School of Policy", id: "U2Nob29sLTE1NTMz" },
  { name: "USC Marshall School of Business", id: "U2Nob29sLTE3NTgx" },
  { name: "USC Annenberg School of Communication", id: "U2Nob29sLTE2ODky" }
];
const FIRST = 10; // max search results

/* --- tiny helper around POSTing GraphQL ---------------------------------- */
async function g<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Referer: 'https://www.ratemyprofessors.com/'   // behaves like browser
    },
    body: JSON.stringify({ query, variables })
  });
  if (!res.ok) throw new Error(`RMP HTTP ${res.status}`);
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json.data as T;
}

/**
 * Try to find a professor by name, searching main USC first, then sub-schools.
 * Returns { id, schoolId, schoolName } or null if not found.
 */
export async function searchProfessor(
  name: string
): Promise<{ id: string, schoolId: string, schoolName: string } | null> {
  type TSearch = {
    newSearch: { teachers: { edges: { node: { id: string } }[] } };
  };

  for (const school of SCHOOL_IDS) {
    const data = await g<TSearch>(SEARCH_TEACHERS, {
      query: {
        text: name,
        schoolID: school.id
      },
      first: FIRST
    });

    const found = data?.newSearch?.teachers.edges[0]?.node.id;
    if (found) {
      return { id: found, schoolId: school.id, schoolName: school.name };
    }
  }
  return null;
}

/* ------------------------------------------------------------------------ */
/* 2 ▸ summary stats (avgRating … no reviews) ****************************** */
/* ------------------------------------------------------------------------ */
export async function getProfessorSummary(teacherId: string) {
  type TSummary = {
    node: {
      avgRating: number;
      numRatings: number;
      difficulty: number;
      wouldTakeAgainPercent: number;
    };
  };

  const data: TSummary = await g<TSummary>(TEACHER_RATINGS_PAGE, {
    id: teacherId,
    first: 0,
    after: null
  });

  return data.node;
}

/* ------------------------------------------------------------------------ */
/* 3 ▸ pull *all* reviews ************************************************** */
/* ------------------------------------------------------------------------ */
export async function getProfessorReviews(teacherId: string) {
  type TPage = {
    node: {
      ratings: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
        edges: { node: any }[];
      };
    };
  };

  const REVIEWS: any[] = [];
  let after: string | null = null;

  while (true) {
    const data: TPage = await g<TPage>(TEACHER_RATINGS_PAGE, {
      id: teacherId,
      first: 20,
      after
    });

    const { pageInfo, edges } = data.node.ratings;
    REVIEWS.push(...edges.map((e: { node: any }) => e.node));

    if (!pageInfo.hasNextPage) break;
    after = pageInfo.endCursor;
  }
  return REVIEWS;
}
