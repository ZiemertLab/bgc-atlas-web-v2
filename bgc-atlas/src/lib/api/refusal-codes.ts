/**
 * The `code` a 400 body carries, so the client can tell WHY a request was
 * refused. The list pages answer each differently: a filter refusal points at
 * the chip row ("remove the filter above"), a deep-page refusal keeps the pager
 * and offers the first page. A 400 without a code gets the server's sentence
 * and nothing else. Client-safe: no server imports.
 */
export const FILTER_REFUSED_CODE = 'filter_refused';
export const DEEP_PAGE_CODE = 'deep_page';
