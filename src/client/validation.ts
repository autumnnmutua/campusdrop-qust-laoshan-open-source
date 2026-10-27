import './zod-config';
/**
 * Form schemas for the client. Loaded on demand (see loadValidation) so zod stays out of the first-load bundle;
 * the server validates every request again with the same schemas.
 */
export {loginSchema,registerSchema} from '../shared/contracts';
export {parcelSchema} from '../shared/delivery';
