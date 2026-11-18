export default async ({ req, res, log }) => {
  log("NOVA owner bootstrap placeholder invoked; no bootstrap action is implemented.");

  return res.json(
    {
      ok: false,
      code: "BOOTSTRAP_NOT_CONFIGURED",
      message: "Owner bootstrap is not configured yet."
    },
    503
  );
};
