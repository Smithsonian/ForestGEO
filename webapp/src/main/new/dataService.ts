import { Stem } from "../../types";

function getData<T>(
  url: string,
  adtlHeaders?: Headers | string[][] | Record<string, string>
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const headers = new Headers({
      ...adtlHeaders,
      "Content-Type": "application/json",
    });

    fetch(url, {
      method: "GET",
      headers,
    })
      .then((response: any) => response.json())
      .then((response: any) => resolve(response))
      .catch((error) => reject(error));
  });
}

function postData(
  url: string,
  body: any,
  adtlHeaders?: Headers | string[][] | Record<string, string>
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const headers = new Headers({
      ...adtlHeaders,
      "Content-Type": "application/json",
    });

    fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    })
      .then(() => resolve())
      .catch((error) => reject(error));
  });
}

export function getCensus(): Promise<Stem[]> {
  // TODO: Remove the access code and generate a new one
  const url =
    "https://forestgeodataapi.azurewebsites.net/api/Census?code=0kOITiOaxOVEYuCNzIc9V6uwhTz41qPvf92RgFF6bBfHQAZcsavyPA==";

  return getData(url);
}

export function insertCensus(stems: Stem[]): Promise<void> {
  // TODO: Remove the access code and generate a new one
  const url =
    "https://forestgeodataapi.azurewebsites.net/api/Census?code=xqRLaAgGAAQkMuMUwFu//JKC7BCEraubIlmfWOZsSBs4IsdbPDMF8w==";

  return postData(url, { payload: stems });
}
