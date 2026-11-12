/* © 2026 专业团队 · CampusDrop v4.7.0 · WM-A372E4790D8B1C09-06D21BCB54 */
import './zod-config';
/**
 * Form schemas for the client. Loaded on demand (see loadValidation) so zod stays out of the first-load bundle;
 * the server validates every request again with the same schemas.
 */
export {loginSchema,registerSchema} from '../shared/contracts';
export {parcelSchema} from '../shared/delivery';
