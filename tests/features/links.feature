# Needs a saved session: npm run login -- .auth/alice.json <BASE_URL>/auth/login
@session:alice
Feature: Signed-in link management

  Background:
    Given I am signed in as "alice"
    And afterwards I DELETE "/api/links?code={{run}}"

  Scenario: create, list, follow and delete a custom link
    When I POST to "/api/links" with JSON:
      """
      {"url": "https://example.com/{{run}}", "code": "{{run}}"}
      """
    Then the status is 201
    And the response does not mention "owner"
    When I GET "/api/links"
    Then the JSON list "links" has an item with "code" = "{{run}}"
    Given I am anonymous
    When I GET "/s/{{run}}"
    Then the status is 302
    And the header "Location" is "https://example.com/{{run}}"
    And the header "Referrer-Policy" is "no-referrer"
    Given I am signed in as "alice"
    When I DELETE "/api/links?code={{run}}"
    Then the status is 200
    Given I am anonymous
    When I GET "/s/{{run}}"
    Then the status is 404

  Scenario: random codes are generated when none is given
    When I POST to "/api/links" with JSON:
      """
      {"url": "https://example.com/{{run}}/random"}
      """
    Then the status is 201
    When I remember "link.code" as "code"
    And afterwards I DELETE "/api/links?code={{saved.code}}"
    Then the JSON "link.url" is "https://example.com/{{run}}/random"

  Scenario: a taken code is refused
    When I POST to "/api/links" with JSON:
      """
      {"url": "https://example.com/a", "code": "{{run}}"}
      """
    And I POST to "/api/links" with JSON:
      """
      {"url": "https://example.com/b", "code": "{{run}}"}
      """
    Then the status is 409

  Scenario: concurrent creates of one code produce exactly one link
    When I POST to "/api/links" 3 times at once with JSON:
      """
      {"url": "https://example.com/race", "code": "{{run}}"}
      """
    Then exactly 1 response has status 201
    And every other response has status 409

  Scenario Outline: hostile or malformed URLs are rejected
    When I POST to "/api/links" with JSON:
      """
      {"url": "<url>"}
      """
    Then the status is 400
    Examples:
      | url                 |
      | javascript:alert(1) |
      | data:text/html,hi   |
      | ftp://files.test/x  |
      | not a url           |

  Scenario: you can't delete a code you don't own
    When I DELETE "/api/links?code=nobody-owns-{{run}}"
    Then the status is 404
