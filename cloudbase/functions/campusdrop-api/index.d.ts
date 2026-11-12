/* © 2026 专业团队 · CampusDrop v4.7.0 · WM-A372E4790D8B1C09-371C40BB7F */
export interface BridgeResponse {statusCode:number;headers:Record<string,string>;body:string;isBase64Encoded?:boolean}
export function createHandler(settings:{APP_ORIGIN?:string;UPSTREAM_ORIGIN?:string},fetchImpl?:typeof fetch):(event:{httpMethod:string;path:string;headers:Record<string,string>;body?:string;queryStringParameters?:Record<string,string>;isBase64Encoded?:boolean})=>Promise<BridgeResponse>;
