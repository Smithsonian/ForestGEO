/* eslint-disable */
self.onmessage = (e) => {
  const { data } = e;
  if (data && data.length > 0) {
    // Upload local data to cloud
    const headers = new Headers({
      "Content-Type": "application/json",
    });

    // TODO: Figure out a way to remove the post dupe code
    fetch(
      "https://forestgeodataapi.azurewebsites.net/api/Census?code=xqRLaAgGAAQkMuMUwFu//JKC7BCEraubIlmfWOZsSBs4IsdbPDMF8w==",
      {
        method: "POST",
        headers,
        body: JSON.stringify(data),
      }
    )
      .then(() => self.postMessage({ succeeded: true }))
      .catch((error) => self.postMessage({ succeeded: false, error }));
  }
};
