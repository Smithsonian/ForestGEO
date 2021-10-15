import { Tree } from "../../types";

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

async function postData(
  url: string,
  body: any,
  adtlHeaders?: Headers | string[][] | Record<string, string>
): Promise<Tree[]> {
  return new Promise<Tree[]>((resolve, reject) => {
    const headers = new Headers({
      ...adtlHeaders,
      "Content-Type": "application/json",
    });

    fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    })
      .then(response => response.text())
      .then(text => JSON.parse(text))
      .then(arr => resolve(arr))
      .catch((error) => reject(error));
  });
}

export function getCensus(): Promise<Tree[]> {
  // TODO: Remove the access code and generate a new one
  const url =
    "https://forestgeodataapi.azurewebsites.net/api/Census?code=0kOITiOaxOVEYuCNzIc9V6uwhTz41qPvf92RgFF6bBfHQAZcsavyPA==";

  return getData(url);
}

export async function insertCensus(stems: Tree[]): Promise<Tree[]> {
  // TODO: Remove the access code and generate a new one
  const url =
    "https://forestgeodataapi.azurewebsites.net/api/Census?code=xqRLaAgGAAQkMuMUwFu//JKC7BCEraubIlmfWOZsSBs4IsdbPDMF8w==";

  return postData(url, stems);
}
