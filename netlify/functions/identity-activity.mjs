/** Netlify invokes this verified event when Identity accepts a sign-in. */
export default {
  userLogin(event) {
    return {
      user: {
        ...event.user,
        appMetadata: {
          ...event.user.appMetadata,
          fed_last_sign_in_at: new Date().toISOString(),
        },
      },
    };
  },
};
