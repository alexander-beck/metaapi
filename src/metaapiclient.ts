
import { IAPIClient, IAPIModel, IAPIOperation, IAPIResult, IAPIError, ErrorKind } from './api';

import {
  ModelParseContext,
  IPropertyStatusMessage
} from '@hn3000/metamodel';

export class APISuccess<TResult> implements IAPIResult<TResult> {
  constructor(private _response:TResult) { }
  isSuccess() { return true; }
  success() { return this._response; }

  error(): Error { return null; }

  response(): any { return this._response; }
}

export class APICallMismatch implements IAPIResult<any> {
  constructor(ctx: ModelParseContext) {
    this._messages = ctx.messages;
    this._error = new Error('parameter validation failed');
    (this._error as any).messages = this._messages;
  }

  isSuccess() { return false; }
  success(): any { return null; }

  error() { return this._error; }
  messages() { return this._messages; }

  response(): any { return null; }

  toString() {
    return this._messages.join(', ');
  }

  private _messages: IPropertyStatusMessage[];
  private _error: Error;
}

export class APIFailure<TResult> implements IAPIResult<TResult> {
  constructor(private _error: Error, private _response: TResult = null) {
  }

  isSuccess() { return false; }
  success(): TResult { return null; }
  error() { return this._error; }
  response(): TResult { return this._response; }
}

export class MetaApiClient implements IAPIClient {
  constructor(apiModel: IAPIModel, baseUrl: string) {
    this._apiModel = apiModel;
    this._baseUrl = baseUrl;
  }

  get model(): IAPIModel { return this._apiModel; }
  get baseUrl(): string { return this._baseUrl; }

  /**
   *
   * @param id of the operation
   * @param req
   *
   * @result will reject to an IAPIError in case of errors
   */
  runOperationById(id: string, req: any): Promise<IAPIResult<any>> {
    let operation = this._apiModel.operationById(id);
    if (null == operation) {
      return Promise.reject(<IAPIError>{
        kind: ErrorKind.InvalidOperation,
        httpStatus: null,
        error: null
      });
    }
    return this.runOperation(operation, req);
  }

  /**
   *
   * @param operation
   * @param req
   *
   * @result will reject to an IAPIError in case of errors
   */
  runOperation<TRequest, TResponse>(operation: IAPIOperation<TRequest, TResponse>, req: TRequest)
  : Promise<IAPIResult<TResponse>> {
    let { method, requestModel } = operation;

    const ctx = new ModelParseContext(req, requestModel.paramsType);
    requestModel.paramsType.validate(ctx);

    if (0 != ctx.errors.length) {
      return Promise.resolve(new APICallMismatch(ctx));
    }
    if (0 != ctx.messages.length) {
      console.warn(`validation messages for ${operation.id}`, ctx.messages);
    }

    let url = this._baseUrl + operation.path(req) + operation.query(req);
    let body = operation.body(req);
    let headers = operation.headers(req);
    //let body = this._body(operation, req);
    //let headers = this._headers(operation, req);

    let requestInit = {
      body,
      headers,
      method,
      mode: 'cors' as RequestMode
    };

    return (
      fetch(url, requestInit)
      .then((result) => Promise.all([ result, result.text() ]) )
      .then(([result, text]) => [ result, text !== "" ? JSON.parse(text) : {} ])
      .then(([result, json]) => [result, this._verify(result, json, operation)])
      .then(([result, json]) => (
        (result.status < 400)
        ? new APISuccess(json as TResponse)
        : new APIFailure(new Error(result.status), json as TResponse)
      ))
      .then(null, (error) => new APIFailure<TResponse>(error))
    );
  }

  private _verify<Req, Resp>(result: Response, json: any, operation: IAPIOperation<Req, Resp>) {
    const resultType = operation.responseModel[result.status];
    if (null == resultType) {
      //console.log(`no result type found for ${operation.method} ${result.url} -> ${result.status}`);
      return json;
    }
    const ctx = new ModelParseContext(json, json);
    resultType.validate(ctx);
    if (ctx.messages.length) {
      let error = new Error('invalid response received');
      (error as any)['validation'] = ctx;
      (error as any)['messages'] = ctx.messages;
      throw error;
    } else {
      console.log(`validated response (successfully) from ${result.url}`);
    }
    return json;
  }
  private _apiModel: IAPIModel;

  private _baseUrl: string;
}