import { DB_HOST } from '@config';

// Mongoose 6+ always uses the new URL parser and unified topology, and no longer accepts
// useFindAndModify, so no driver options are needed here.
export const dbConnection = DB_HOST && {
  url: DB_HOST,
  options: {},
};
