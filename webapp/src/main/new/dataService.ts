import { Stem } from "../../types";

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

export function insertStems(stems: Stem[]): Promise<void> {
  // TODO: Remove the access code and generate a new one
  const url =
    "https://forestgeo-middletier.azurewebsites.net/api/InsertItems?code=D2BT0IK717/vf8YFkdNe2bXTzYMTZkKty4qlTk0FdpxCBJAF146xzw==";

  return postData(url, { payload: stems });
}
