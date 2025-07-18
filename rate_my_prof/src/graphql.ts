/* GraphQL query strings *exactly* as the website fires them */

export const SEARCH_TEACHERS = /* GraphQL */ `
    query SearchTeachers($query: TeacherSearchQuery!, $first: Int!) {
        newSearch {
            teachers(query: $query, first: $first) {
                edges {
                    node {
                        id
                        firstName
                        lastName
                        avgRating
                        numRatings
                    }
                }
            }
        }
    }
`;

export const TEACHER_RATINGS_PAGE = /* GraphQL */ `
  query TeacherRatings($id: ID!, $first: Int!, $after: String) {
    node(id: $id) {
      ... on Teacher {
        avgRating
        numRatings
        avgDifficulty
        wouldTakeAgainPercent
        ratings(first: $first, after: $after) {
            pageInfo { hasNextPage endCursor }
            edges {
                node {
                    id
                    class
                    date
                    comment
                    qualityRating
                    difficultyRating
                    wouldTakeAgain
                }
            }
        }
      }
    }
  }
`;
