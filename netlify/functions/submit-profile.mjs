export default async function submitProfile() {
	return Response.json(
		{
			message:
				"Profile submissions are not available until server-side validation is configured.",
		},
		{ status: 501 },
	);
}

export const config = {
	method: "POST",
};
