package users

import "testing"

func TestParseRoleAcceptsOnlySupportedRoles(t *testing.T) {
	for _, test := range []struct {
		name  string
		input string
		want  Role
	}{
		{name: "agent", input: "agent", want: RoleAgent},
		{name: "supervisor", input: "supervisor", want: RoleSupervisor},
	} {
		t.Run(test.name, func(t *testing.T) {
			got, err := ParseRole(test.input)
			if err != nil || got != test.want {
				t.Fatalf("ParseRole(%q) = %q, %v; want %q", test.input, got, err, test.want)
			}
		})
	}

	for _, input := range []string{"", "Agent", "admin", "agent ", "supervisor \\n"} {
		t.Run("reject_"+input, func(t *testing.T) {
			if _, err := ParseRole(input); err != ErrInvalidRole {
				t.Fatalf("ParseRole(%q) error = %v; want ErrInvalidRole", input, err)
			}
		})
	}
}
