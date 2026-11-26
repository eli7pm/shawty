# Needs two saved sessions from two different Google test accounts.
@session:alice @session:bob
Feature: Users are isolated from each other

  Scenario: bob can't see or delete alice's link, but can follow it
    Given I am signed in as "alice"
    And afterwards I DELETE "/api/links?code={{run}}"
    When I POST to "/api/links" with JSON:
      """
      {"url": "https://example.com/{{run}}", "code": "{{run}}"}
      """
    Then the status is 201
    Given I am signed in as "bob"
    When I GET "/api/links"
    Then the status is 200
    And the JSON list "links" has no item with "code" = "{{run}}"
    When I DELETE "/api/links?code={{run}}"
    Then the status is 404
    Given I am anonymous
    When I GET "/s/{{run}}"
    Then the status is 302
